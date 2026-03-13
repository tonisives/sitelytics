use crate::api::DashboardData;
use crate::app::{logout, DashboardCache, DashboardGaCache};
use crate::pages::detail::build_sparkline_path;
use crate::pages::login::LoginPage;
use leptos::prelude::*;
use std::collections::HashMap;

#[server(FetchGscData, "/api")]
pub async fn fetch_gsc_data(days: u64) -> Result<DashboardData, ServerFnError> {
    let req = expect_context::<http::request::Parts>();
    let session = crate::api::server::extract_session(&req.headers)
        .await
        .ok_or_else(|| ServerFnError::new("Not authenticated"))?;
    crate::api::server::apply_session_cookie(&session);
    eprintln!("[gsc] fetching dashboard data for {} days", days);
    let result = crate::api::server::fetch_dashboard(&session.access_token, days).await;
    match &result {
        Ok(data) => eprintln!("[gsc] got {} properties", data.properties.len()),
        Err(e) => eprintln!("[gsc] error: {}", e),
    }
    result.map_err(ServerFnError::new)
}

/// GA data per property: (total, daily values for sparkline)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GaPropertyData {
    pub total: f64,
    pub daily: Vec<f64>,
}

/// Fetch GA sessions for all properties (total + daily for sparkline)
#[server(FetchAllGaSessions, "/api")]
pub async fn fetch_all_ga_sessions(
    site_urls: Vec<String>,
    days: u64,
) -> Result<HashMap<String, GaPropertyData>, ServerFnError> {
    let req = expect_context::<http::request::Parts>();
    let session = crate::api::server::extract_session(&req.headers)
        .await
        .ok_or_else(|| ServerFnError::new("Not authenticated"))?;
    crate::api::server::apply_session_cookie(&session);

    let mut result = HashMap::new();

    // Pre-warm the GA property cache
    let _ = crate::api::server::resolve_ga_property(&session.access_token, "").await;

    let mut tasks = tokio::task::JoinSet::new();
    for url in site_urls {
        let token = session.access_token.clone();
        let d = days;
        tasks.spawn(async move {
            let prop_id = crate::api::server::resolve_ga_property(&token, &url).await;
            if let Some(pid) = prop_id {
                let daily = crate::api::server::fetch_ga_daily_sessions(&token, &pid, d).await;
                if let Ok(rows) = daily {
                    let total: f64 = rows.iter().map(|(_, s)| s).sum();
                    let values: Vec<f64> = rows.iter().map(|(_, s)| *s).collect();
                    return Some((url, GaPropertyData { total, daily: values }));
                }
            }
            None
        });
    }

    while let Some(res) = tasks.join_next().await {
        if let Ok(Some((url, data))) = res {
            result.insert(url, data);
        }
    }

    eprintln!("[ga-sessions] returning {} entries", result.len());
    Ok(result)
}

fn is_auth_error(e: &ServerFnError) -> bool {
    e.to_string().contains("Not authenticated")
}

#[component]
pub fn DashboardPage() -> impl IntoView {
    let cache = expect_context::<DashboardCache>();

    // Restore days from cache or default to 28
    let initial_days = cache.get_untracked().map_or(28, |(d, _)| d);
    let (days, set_days) = signal(initial_days);

    let data = Resource::new(
        move || days.get(),
        move |d| {
            // If cache matches, return cached data without fetching
            let cached = cache.get_untracked();
            async move {
                if let Some((cached_days, cached_data)) = cached {
                    if cached_days == d {
                        return Ok(cached_data);
                    }
                }
                fetch_gsc_data(d).await
            }
        },
    );

    // Write results to cache
    Effect::new(move || {
        if let Some(Ok(d)) = data.get() {
            cache.set(Some((days.get_untracked(), d)));
        }
    });

    let handle_logout = move |_| {
        leptos::task::spawn_local(async move {
            let _ = logout().await;
            let _ = leptos::prelude::window().location().set_href("/");
        });
    };

    // GA sessions - app-level cache, keyed by days
    let ga_cache = expect_context::<DashboardGaCache>();

    view! {
        <Suspense fallback=|| view! { <div class="loading">"Loading..."</div> }>
            {move || data.get().map(|result| match result {
                Err(e) if is_auth_error(&e) => view! { <LoginPage/> }.into_any(),
                Ok(d) => view! {
                    <div class="container">
                        <header class="dash-header">
                            <h1>"Sitelytics"</h1>
                            <div class="dash-controls">
                                <div class="day-buttons">
                                    <DayButton days=days set_days=set_days value=7/>
                                    <DayButton days=days set_days=set_days value=28/>
                                    <DayButton days=days set_days=set_days value=90/>
                                </div>
                                <button class="logout-btn" on:click=handle_logout>"Sign out"</button>
                            </div>
                        </header>
                        <DashboardContent data=d days=days.get() ga_cache=ga_cache/>
                    </div>
                }.into_any(),
                Err(e) => view! {
                    <div class="container">
                        <div class="error-text">{e.to_string()}</div>
                    </div>
                }.into_any(),
            })}
        </Suspense>
    }
}

#[component]
fn DayButton(days: ReadSignal<u64>, set_days: WriteSignal<u64>, value: u64) -> impl IntoView {
    let active = move || days.get() == value;
    let handle_click = move |_| set_days.set(value);
    let label = format!("{value}d");

    view! {
        <button
            class:day-btn=true
            class:day-btn-active=active
            on:click=handle_click
        >
            {label}
        </button>
    }
}

#[component]
fn DashboardContent(
    data: DashboardData,
    days: u64,
    ga_cache: DashboardGaCache,
) -> impl IntoView {
    let label = format!("Last {days} days");

    // GA sessions - fetch client-side only, skip if already cached
    let urls: Vec<String> = data.properties.iter().map(|p| p.site_url.clone()).collect();
    let cached = ga_cache
        .get_untracked()
        .filter(|(d, _)| *d == days)
        .is_some();
    if !urls.is_empty() && !cached {
        Effect::new(move |_| {
            let urls = urls.clone();
            leptos::task::spawn_local(async move {
                if let Ok(map) = fetch_all_ga_sessions(urls, days).await {
                    ga_cache.set(Some((days, map)));
                }
            });
        });
    }

    let ga_map = Memo::new(move |_| {
        ga_cache
            .get()
            .filter(|(d, _)| *d == days)
            .map(|(_, m)| m)
            .unwrap_or_default()
    });

    let total_ga_sessions = Memo::new(move |_| {
        let m = ga_map.get();
        if m.is_empty() { None } else { Some(m.values().map(|d| d.total).sum::<f64>()) }
    });

    view! {
        <div class="stats-grid">
            <StatCard label="Impressions" value=format_number(data.totals.impressions) sub=label.clone()/>
            <StatCard label="Clicks" value=format_number(data.totals.clicks) sub=label.clone()/>
            <StatCard label="CTR" value=format_ctr(data.totals.ctr) sub=String::new()/>
            <StatCard label="Avg Position" value=format_position(data.totals.position) sub=String::new()/>
            <div class="stat-card">
                <div class="stat-label">"Sessions"</div>
                <div class="stat-value">{move || total_ga_sessions.get().map(format_number).unwrap_or_else(|| "-".into())}</div>
                <div class="stat-sub color-teal">"Google Analytics"</div>
            </div>
        </div>

        <h2>{format!("Properties ({})", data.properties.len())}</h2>

        <div class="table-card">
            <table class="prop-table">
                <thead>
                    <tr>
                        <th>"Property"</th>
                        <th class="num-cell">"Impressions"</th>
                        <th class="num-cell">"Clicks"</th>
                        <th class="num-cell">"CTR"</th>
                        <th class="num-cell">"Position"</th>
                        <th class="num-cell ga-col">"Sessions"</th>
                        <th class="sparkline-header">"Impressions"</th>
                        <th class="sparkline-header ga-col">"Sessions"</th>
                    </tr>
                </thead>
                <tbody>
                    {data.properties.into_iter().map(|p| {
                        let sparkline = build_sparkline_path(&p.daily, |r| r.impressions);
                        let href = format!("/property/{}", urlencoding::encode(&p.site_url));
                        let site_url = p.site_url.clone();
                        view! {
                            <tr class="prop-row-link">
                                <td class="prop-name"><a href={href.clone()} class="row-link">{clean_url(&p.site_url)}</a></td>
                                <td class="num-cell"><a href={href.clone()} class="row-link">{format_number(p.impressions)}</a></td>
                                <td class="num-cell"><a href={href.clone()} class="row-link">{format_number(p.clicks)}</a></td>
                                <td class="num-cell"><a href={href.clone()} class="row-link">{format_ctr(p.ctr)}</a></td>
                                <td class="num-cell"><a href={href.clone()} class="row-link">{format_position(p.position)}</a></td>
                                <td class="num-cell ga-col">
                                    <a href={href.clone()} class="row-link color-teal">{
                                        let url = site_url.clone();
                                        move || ga_map.get().get(&url).map(|d| format_number(d.total)).unwrap_or_else(|| "-".to_string())
                                    }</a>
                                </td>
                                <td class="sparkline-cell">
                                    <a href={href.clone()} class="row-link">
                                        <svg class="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
                                            <path d={sparkline} fill="none" stroke="var(--accent)" stroke-width="1.5"/>
                                        </svg>
                                    </a>
                                </td>
                                <td class="sparkline-cell">
                                    <a href={href} class="row-link">{
                                        let url2 = site_url.clone();
                                        move || {
                                            let path = ga_map.get().get(&url2).map(|d| build_sparkline_from_values(&d.daily)).unwrap_or_default();
                                            if path.is_empty() {
                                                return view! { <span></span> }.into_any();
                                            }
                                            view! {
                                                <svg class="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
                                                    <path d={path} fill="none" stroke="var(--chart-teal)" stroke-width="1.5"/>
                                                </svg>
                                            }.into_any()
                                        }
                                    }</a>
                                </td>
                            </tr>
                        }
                    }).collect::<Vec<_>>()}
                </tbody>
            </table>
        </div>
    }
}

#[component]
fn StatCard(label: &'static str, value: String, sub: String) -> impl IntoView {
    let show_sub = if sub.is_empty() { "none" } else { "block" };
    view! {
        <div class="stat-card">
            <div class="stat-label">{label}</div>
            <div class="stat-value">{value}</div>
            <div class="stat-sub" style:display=show_sub>{sub}</div>
        </div>
    }
}

fn build_sparkline_from_values(values: &[f64]) -> String {
    if values.is_empty() {
        return String::new();
    }
    let max = values.iter().cloned().fold(0.0f64, f64::max);
    let max = if max == 0.0 { 1.0 } else { max };
    let w = 80.0;
    let h = 24.0;
    let step = if values.len() > 1 {
        w / (values.len() - 1) as f64
    } else {
        w
    };
    let mut path = String::new();
    for (i, v) in values.iter().enumerate() {
        let x = i as f64 * step;
        let y = h - (v / max * (h - 2.0) + 1.0);
        if i == 0 {
            path.push_str(&format!("M{:.1},{:.1}", x, y));
        } else {
            path.push_str(&format!(" L{:.1},{:.1}", x, y));
        }
    }
    path
}

fn clean_url(url: &str) -> String {
    url.trim_start_matches("sc-domain:")
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string()
}

fn format_number(n: f64) -> String {
    let n = n as i64;
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}K", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

fn format_ctr(n: f64) -> String {
    format!("{:.1}%", n * 100.0)
}

fn format_position(n: f64) -> String {
    format!("{:.1}", n)
}
