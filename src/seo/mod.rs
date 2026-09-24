pub mod api;
pub mod crawl;
pub mod google;
pub mod worker;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MODULES: [&str; 4] = ["keywords", "rankings", "research", "audit"];
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModuleSettings {
    pub enabled: bool,
    pub weekly: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub root_url: String,
    pub modules: BTreeMap<String, ModuleSettings>,
    pub keywords: Vec<String>,
    pub competitors: Vec<String>,
    pub link_candidates: Vec<String>,
    pub render_urls: Vec<String>,
    pub country: String,
    pub language: String,
    pub page_limit: usize,
}
impl Config {
    pub fn initial(site: &str) -> Self {
        Self {
            root_url: if let Some(domain) = site.strip_prefix("sc-domain:") {
                format!("https://{domain}/")
            } else {
                site.into()
            },
            modules: MODULES
                .into_iter()
                .map(|m| (m.into(), ModuleSettings::default()))
                .collect(),
            keywords: vec![],
            competitors: vec![],
            link_candidates: vec![],
            render_urls: vec![],
            country: "us".into(),
            language: "en".into(),
            page_limit: 100,
        }
    }
    pub fn enabled(&self, module: &str) -> bool {
        self.modules.get(module).is_some_and(|m| m.enabled)
    }
    pub fn validate(&mut self, site: &str) -> Result<(), String> {
        let root = reqwest::Url::parse(&self.root_url).map_err(|_| "Invalid root URL")?;
        crawl::validate_url(&root)?;
        let host = root.host_str().ok_or("Root needs a hostname")?;
        if let Some(domain) = site.strip_prefix("sc-domain:") {
            if host != domain && !host.ends_with(&format!(".{domain}")) {
                return Err("Root must belong to the GSC property".into());
            }
        } else {
            let property = reqwest::Url::parse(site).map_err(|_| "Invalid GSC property")?;
            if root.origin() != property.origin() || !root.path().starts_with(property.path()) {
                return Err("Root must remain within the GSC URL-prefix property".into());
            }
        }
        if self.modules.keys().any(|m| !MODULES.contains(&m.as_str())) {
            return Err("Unknown module".into());
        }
        for module in MODULES {
            self.modules.entry(module.into()).or_default();
        }
        if !(1..=500).contains(&self.page_limit) {
            return Err("Page limit must be 1–500".into());
        }
        for list in [
            &mut self.keywords,
            &mut self.competitors,
            &mut self.link_candidates,
            &mut self.render_urls,
        ] {
            *list = list
                .iter()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            list.sort();
            list.dedup();
        }
        if self.keywords.len() > 100
            || self.competitors.len() > 10
            || self.link_candidates.len() > 25
            || self.render_urls.len() > 5
        {
            return Err(
                "Limits: 100 keywords, 10 competitors, 25 candidate URLs, 5 rendered pages".into(),
            );
        }
        if self.keywords.iter().any(|s| s.len() > 200) {
            return Err("Keywords must be at most 200 bytes".into());
        }
        for domain in &self.competitors {
            let url = reqwest::Url::parse(&format!("https://{domain}/"))
                .map_err(|_| "Invalid competitor domain")?;
            crawl::validate_url(&url)?;
            if url.host_str() != Some(domain.as_str()) || url.path() != "/" {
                return Err("Enter competitor hostnames only".into());
            }
        }
        for address in self.link_candidates.iter().chain(&self.render_urls) {
            let url = reqwest::Url::parse(address).map_err(|_| "Invalid page URL")?;
            crawl::validate_url(&url)?;
        }
        for address in &self.render_urls {
            let url = reqwest::Url::parse(address).map_err(|_| "Invalid rendered URL")?;
            if !crawl::in_scope(&root, &url) {
                return Err("Rendered pages must be within the site root".into());
            }
        }
        if self.country.len() != 2
            || !self.country.bytes().all(|c| c.is_ascii_lowercase())
            || self.language.len() < 2
            || self.language.len() > 10
            || !self
                .language
                .bytes()
                .all(|c| c.is_ascii_alphabetic() || c == b'-')
        {
            return Err("Use a two-letter country and language code, such as us/en".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_scope_and_defaults() {
        let mut c = Config::initial("sc-domain:example.com");
        assert!(!c.enabled("audit"));
        assert!(c.validate("sc-domain:example.com").is_ok());
        c.root_url = "https://evil-example.com/".into();
        assert!(c.validate("sc-domain:example.com").is_err());
        c.root_url = "https://example.com/other/".into();
        assert!(c.validate("https://example.com/blog/").is_err());
    }
}
