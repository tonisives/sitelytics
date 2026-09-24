use super::Config;
use crate::state::AppState;
use reqwest::Url;
use scraper::{Html, Selector};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet, VecDeque},
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use uuid::Uuid;

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !(v.is_private()
                || v.is_loopback()
                || v.is_link_local()
                || v.is_broadcast()
                || v.is_documentation()
                || v.is_unspecified()
                || v.is_multicast()
                || o[0] == 0
                || o[0] >= 240
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
                || (o[0] == 192 && o[1] == 0))
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            v.to_ipv4_mapped().map(public_v4).unwrap_or(
                (s[0] & 0xe000) == 0x2000
                    && !(s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x200))
                    && s[0] != 0x2002,
            )
        }
    }
}
fn public_v4(v: std::net::Ipv4Addr) -> bool {
    public_ip(IpAddr::V4(v))
}
pub fn validate_url(url: &Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err("Only public HTTP(S) URLs on standard ports are supported".into());
    }
    let host = url
        .host_str()
        .ok_or("Missing hostname")?
        .trim_matches(['[', ']']);
    if host == "localhost"
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".svc")
        || host.ends_with(".cluster.local")
        || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))
    {
        return Err("Private addresses are not allowed".into());
    }
    Ok(())
}
pub fn in_scope(root: &Url, url: &Url) -> bool {
    root.origin() == url.origin() && url.path().starts_with(root.path())
}
pub struct Page {
    pub url: Url,
    pub status: u16,
    pub body: String,
    pub robots: String,
    pub redirects: Vec<String>,
    pub content_type: String,
}
pub async fn fetch(url: &Url, scope: Option<&Url>) -> Result<Page, String> {
    fetch_checked(url, scope, None).await
}
async fn fetch_checked(
    url: &Url,
    scope: Option<&Url>,
    robots: Option<&Robots>,
) -> Result<Page, String> {
    let mut current = url.clone();
    let mut redirects = vec![];
    for _ in 0..6 {
        validate_url(&current)?;
        if robots.is_some_and(|rules| !rules.allows(&current)) {
            return Err("Redirect excluded by robots.txt".into());
        }
        if scope.is_some_and(|root| !in_scope(root, &current)) {
            return Err("Redirect left crawl scope".into());
        }
        let host = current.host_str().ok_or("Missing host")?;
        let addresses: Vec<SocketAddr> =
            tokio::net::lookup_host((host, current.port_or_known_default().unwrap_or(443)))
                .await
                .map_err(|_| "DNS lookup failed")?
                .collect();
        if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
            return Err("DNS resolved to a non-public address".into());
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .user_agent("SitelyticsBot/1.0")
            .resolve_to_addrs(host, &addresses)
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(current.clone())
            .send()
            .await
            .map_err(|_| "Page request failed")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("Redirect missing location")?;
            redirects.push(current.to_string());
            current = current.join(location).map_err(|_| "Invalid redirect")?;
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        }
        let status = response.status().as_u16();
        let robots = response
            .headers()
            .get("x-robots-tag")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "Response interrupted")? {
            if bytes.len() + chunk.len() > 2_000_000 {
                return Err("Page exceeds 2 MB limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(Page {
            url: current,
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            robots,
            redirects,
            content_type,
        });
    }
    Err("Redirect loop or more than five redirects".into())
}
#[derive(Default, Debug)]
pub struct Robots {
    rules: Vec<(bool, String)>,
    pub sitemaps: Vec<String>,
}
impl Robots {
    pub fn parse(text: &str) -> Self {
        let mut groups: Vec<(Vec<String>, Vec<(bool, String)>)> = vec![];
        let mut agents = vec![];
        let mut rules = vec![];
        let mut sitemaps = vec![];
        for line in text.lines() {
            let line = line.split('#').next().unwrap_or("").trim();
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let value = value.trim();
            match key.trim().to_lowercase().as_str() {
                "user-agent" => {
                    if !rules.is_empty() {
                        groups.push((std::mem::take(&mut agents), std::mem::take(&mut rules)));
                    }
                    agents.push(value.to_lowercase());
                }
                "allow" | "disallow" if !agents.is_empty() && !value.is_empty() => {
                    rules.push((key.trim().eq_ignore_ascii_case("allow"), value.into()))
                }
                "sitemap" => sitemaps.push(value.into()),
                _ => {}
            }
        }
        groups.push((agents, rules));
        let specific = groups
            .iter()
            .any(|(a, _)| a.iter().any(|s| s.contains("sitelytics")));
        let rules = groups
            .into_iter()
            .filter(|(agents, _)| {
                agents.iter().any(|s| {
                    if specific {
                        s.contains("sitelytics")
                    } else {
                        s == "*"
                    }
                })
            })
            .flat_map(|(_, rules)| rules)
            .collect();
        Self { rules, sitemaps }
    }
    pub fn allows(&self, url: &Url) -> bool {
        let target = format!(
            "{}{}",
            url.path(),
            url.query().map(|s| format!("?{s}")).unwrap_or_default()
        );
        self.rules
            .iter()
            .filter(|(_, pattern)| robot_matches(pattern, &target))
            .max_by_key(|(allow, p)| (p.replace('*', "").len(), *allow))
            .map(|(allow, _)| *allow)
            .unwrap_or(true)
    }
}
fn robot_matches(pattern: &str, target: &str) -> bool {
    let anchored = pattern.ends_with('$');
    let base = pattern.trim_end_matches('$');
    let regex = format!(
        "^{}{}",
        base.split('*')
            .map(regex::escape)
            .collect::<Vec<_>>()
            .join(".*"),
        if anchored { "$" } else { "" }
    );
    regex::Regex::new(&regex).is_ok_and(|r| r.is_match(target))
}
fn selected_text(doc: &Html, selector: &str) -> Vec<String> {
    Selector::parse(selector)
        .ok()
        .map(|s| {
            doc.select(&s)
                .map(|n| {
                    n.text()
                        .collect::<Vec<_>>()
                        .join(" ")
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect()
        })
        .unwrap_or_default()
}
fn attributes(doc: &Html, selector: &str, attr: &str) -> Vec<String> {
    Selector::parse(selector)
        .ok()
        .map(|s| {
            doc.select(&s)
                .filter_map(|n| n.value().attr(attr).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}
pub fn inspect(body: &str, url: &Url) -> Value {
    let doc = Html::parse_document(body);
    let titles = selected_text(&doc, "title");
    let descriptions = attributes(&doc, "meta[name='description']", "content");
    let headings = selected_text(&doc, "h1");
    let links: Vec<String> = attributes(&doc, "a[href]", "href")
        .into_iter()
        .filter_map(|href| url.join(&href).ok())
        .filter(|u| matches!(u.scheme(), "http" | "https"))
        .map(|mut u| {
            u.set_fragment(None);
            u.to_string()
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let canonical = attributes(&doc, "link[rel~='canonical']", "href")
        .first()
        .and_then(|s| url.join(s).ok())
        .map(|u| u.to_string());
    let robots = attributes(&doc, "meta[name='robots']", "content")
        .join(",")
        .to_lowercase();
    json!({"url":url.as_str(),"title":titles.first().cloned().unwrap_or_default(),"description":descriptions.first().cloned().unwrap_or_default(),"h1":headings,"canonical":canonical,"noindex":robots.contains("noindex"),"links":links,"text_length":selected_text(&doc,"body").join(" ").len()})
}
pub async fn active(state: &AppState, id: Uuid) -> Result<bool, String> {
    sqlx::query_scalar("SELECT status IN ('running','waiting_browser') FROM seo_jobs WHERE id=$1")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())
}
fn issue(issues: &mut Vec<Value>, url: &str, code: &str, detail: &str) {
    issues.push(json!({"url":url,"code":code,"detail":detail}));
}
pub async fn audit(state: &AppState, id: Uuid, config: &Config) -> Result<Value, String> {
    let root = Url::parse(&config.root_url).map_err(|e| e.to_string())?;
    let robots_url = root.join("/robots.txt").map_err(|e| e.to_string())?;
    let robots_page = fetch(&robots_url, None).await?;
    if robots_page.status >= 500 || matches!(robots_page.status, 401 | 403 | 429) {
        return Err("robots.txt unavailable; crawl paused".into());
    }
    let robots = Robots::parse(if robots_page.status == 200 {
        &robots_page.body
    } else {
        ""
    });
    let mut queue = VecDeque::from([root.to_string()]);
    let mut sitemap_urls = HashSet::new();
    let mut issues = vec![];
    let mut pages = vec![];
    let mut seen = HashSet::new();
    let mut errors = vec![];
    let mut maps: VecDeque<String> = robots.sitemaps.iter().cloned().collect();
    maps.push_back(
        root.join("/sitemap.xml")
            .map_err(|e| e.to_string())?
            .to_string(),
    );
    let mut seen_maps = HashSet::new();
    while let Some(address) = maps.pop_front() {
        if seen_maps.len() >= 10 || !active(state, id).await? {
            break;
        }
        if !seen_maps.insert(address.clone()) {
            continue;
        }
        let Ok(url) = Url::parse(&address) else {
            continue;
        };
        if url.origin() != root.origin() || !robots.allows(&url) {
            continue;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
        match fetch(&url, Some(&root.join("/").map_err(|e| e.to_string())?)).await {
            Ok(page) if page.status == 200 => {
                let doc = Html::parse_document(&page.body);
                let locations = selected_text(&doc, "loc");
                let index = page.body.contains("<sitemapindex");
                for address in locations.into_iter().take(5000) {
                    if index {
                        if maps.len() < 20 {
                            maps.push_back(address);
                        }
                    } else if Url::parse(&address).is_ok_and(|u| in_scope(&root, &u)) {
                        sitemap_urls.insert(address.clone());
                        if queue.len() < 5000 {
                            queue.push_back(address);
                        }
                    }
                }
            }
            Ok(page) if page.status != 404 => {
                errors.push(json!({"url":address,"error":format!("Sitemap HTTP {}",page.status)}))
            }
            Err(error) => errors.push(json!({"url":address,"error":error})),
            _ => {}
        }
    }
    while let Some(address) = queue.pop_front() {
        if seen.len() >= config.page_limit || !active(state, id).await? {
            break;
        }
        if !seen.insert(address.clone()) {
            continue;
        }
        let Ok(url) = Url::parse(&address) else {
            continue;
        };
        if !in_scope(&root, &url) {
            continue;
        }
        if !robots.allows(&url) {
            errors.push(json!({"url":address,"error":"Excluded by robots.txt"}));
            continue;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
        match fetch_checked(&url, Some(&root), Some(&robots)).await {
            Err(error) => {
                issue(&mut issues, &address, "fetch_failed", &error);
                errors.push(json!({"url":address,"error":error}));
            }
            Ok(page) => {
                if page.status >= 400 {
                    issue(
                        &mut issues,
                        &address,
                        "http_error",
                        &format!("HTTP {}", page.status),
                    );
                }
                if !page.redirects.is_empty() {
                    issue(
                        &mut issues,
                        &address,
                        "redirect",
                        &format!("{} redirect(s) to {}", page.redirects.len(), page.url),
                    );
                }
                if !page.content_type.contains("html") && !page.content_type.is_empty() {
                    pages.push(json!({"url":address,"status":page.status,"content_type":page.content_type}));
                    continue;
                }
                let mut info = inspect(&page.body, &page.url);
                info["requested_url"] = json!(address);
                info["status"] = json!(page.status);
                info["redirects"] = json!(page.redirects);
                if page.status == 200 {
                    for (key, code) in [
                        ("title", "missing_title"),
                        ("description", "missing_description"),
                    ] {
                        if info[key].as_str().unwrap_or("").is_empty() {
                            issue(&mut issues, &address, code, "Missing or empty metadata");
                        }
                    }
                    let headings = info["h1"].as_array().map_or(0, Vec::len);
                    if headings != 1 {
                        issue(
                            &mut issues,
                            &address,
                            "heading_count",
                            &format!("Found {headings} H1 headings"),
                        );
                    }
                    if page.robots.contains("noindex") {
                        info["noindex"] = json!(true);
                    }
                    if info["noindex"] == true {
                        issue(
                            &mut issues,
                            &address,
                            "noindex",
                            "Page asks search engines not to index it",
                        );
                        if sitemap_urls.contains(&address) {
                            issue(
                                &mut issues,
                                &address,
                                "sitemap_noindex",
                                "Noindex page included in sitemap",
                            );
                        }
                    }
                    match info["canonical"].as_str() {
                        None => issue(
                            &mut issues,
                            &address,
                            "missing_canonical",
                            "No canonical URL",
                        ),
                        Some(c) if c != page.url.as_str() => {
                            issue(&mut issues, &address, "alternate_canonical", c)
                        }
                        _ => {}
                    }
                    if info["text_length"].as_u64().unwrap_or(0) < 100 {
                        issue(
                            &mut issues,
                            &address,
                            "limited_html",
                            "Little server-rendered text; inspect a rendered page if needed",
                        );
                    }
                    if let Some(links) = info["links"].as_array() {
                        for link in links.iter().filter_map(Value::as_str) {
                            if queue.len() < 5000
                                && Url::parse(link)
                                    .is_ok_and(|u| in_scope(&root, &u) && u.query().is_none())
                                && !seen.contains(link)
                            {
                                queue.push_back(link.into());
                            }
                        }
                    }
                }
                pages.push(info);
            }
        }
    }
    for key in ["title", "description"] {
        let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for page in &pages {
            if let Some(v) = page[key].as_str().filter(|s| !s.is_empty()) {
                grouped
                    .entry(v.into())
                    .or_default()
                    .push(page["url"].as_str().unwrap_or("").into());
            }
        }
        for urls in grouped.values().filter(|v| v.len() > 1) {
            for url in urls {
                issue(
                    &mut issues,
                    url,
                    &format!("duplicate_{key}"),
                    &format!("Shared by {} crawled pages", urls.len()),
                );
            }
        }
    }
    let broken: HashSet<String> = pages
        .iter()
        .filter(|p| p["status"].as_u64().unwrap_or(0) >= 400)
        .flat_map(|p| {
            [p["url"].as_str(), p["requested_url"].as_str()]
                .into_iter()
                .flatten()
                .map(str::to_string)
        })
        .collect();
    for page in &pages {
        if let Some(links) = page["links"].as_array() {
            for link in links
                .iter()
                .filter_map(Value::as_str)
                .filter(|s| broken.contains(*s))
            {
                issue(
                    &mut issues,
                    page["url"].as_str().unwrap_or(""),
                    "broken_internal_link",
                    link,
                );
            }
        }
    }
    let old:Option<Value>=sqlx::query_scalar("SELECT result FROM seo_jobs WHERE site_id=(SELECT site_id FROM seo_jobs WHERE id=$1) AND module='audit' AND status='succeeded' AND id<>$1 ORDER BY completed_at DESC LIMIT 1").bind(id).fetch_optional(&state.db).await.map_err(|e|e.to_string())?;
    let key = |i: &Value| format!("{}|{}|{}", i["url"], i["code"], i["detail"]);
    let previous: Vec<Value> = old
        .as_ref()
        .and_then(|v| v["issues"].as_array())
        .cloned()
        .unwrap_or_default();
    let prevkeys: HashSet<String> = previous.iter().map(key).collect();
    let current: HashSet<String> = issues.iter().map(key).collect();
    let complete = queue.is_empty() && errors.is_empty();
    let new: Vec<Value> = issues
        .iter()
        .filter(|i| !prevkeys.contains(&key(i)))
        .cloned()
        .collect();
    let resolved: Vec<Value> = if complete {
        previous
            .into_iter()
            .filter(|i| !current.contains(&key(i)))
            .collect()
    } else {
        vec![]
    };
    Ok(
        json!({"source":"Sitelytics HTTP crawl","collected_at":chrono::Utc::now(),"root_url":root.as_str(),"pages":pages,"issues":issues,"issue_count":issues.len(),"new_issues":new,"resolved_issues":resolved,"has_baseline":old.is_some(),"errors":errors,"complete":complete,"coverage":{"visited":seen.len(),"page_limit":config.page_limit,"remaining":queue.len(),"sitemap_urls":sitemap_urls.len()},"render_urls":config.render_urls}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ssrf_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
        ] {
            assert!(!public_ip(address.parse().expect("ip")));
        }
        assert!(public_ip("8.8.8.8".parse().expect("ip")));
    }
    #[test]
    fn robots_specificity() {
        let r = Robots::parse(
            "User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*?*\n",
        );
        assert!(!r.allows(&Url::parse("https://example.com/private/x").expect("url")));
        assert!(r.allows(&Url::parse("https://example.com/private/public").expect("url")));
        assert!(!r.allows(&Url::parse("https://example.com/a?x=1").expect("url")));
    }
    #[test]
    fn html_signals() {
        let v = inspect(
            "<title>A</title><meta name='robots' content='noindex'><h1>Hi</h1><a href='/missing#x'>Link</a>",
            &Url::parse("https://example.com/").expect("url"),
        );
        assert_eq!(v["title"], "A");
        assert_eq!(v["noindex"], true);
        assert_eq!(v["links"][0], "https://example.com/missing");
    }
}
