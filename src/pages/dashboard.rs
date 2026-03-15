use crate::api::DashboardData;
use crate::app::{logout, DashboardCache, DashboardGaCache};
use crate::pages::detail::build_sparkline_path;
use crate::pages::login::LoginPage;
use leptos::prelude::*;
use std::collections::HashMap;
use leptos::wasm_bindgen::JsCast;
use leptos::web_sys;

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
    /// (date, value) pairs for detail view reuse
    pub daily_dated: Vec<(String, f64)>,
    pub property_id: String,
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
                    return Some((url, GaPropertyData { total, daily: values, daily_dated: rows, property_id: pid }));
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

    Effect::new(move || {
        if let Some(Ok(d)) = data.get() {
            cache.set(Some((days.get_untracked(), d)));
        }
    });

    let ga_cache = expect_context::<DashboardGaCache>();

    view! {
        <Suspense fallback=|| view! { <div class="loading">"Loading..."</div> }>
            {move || data.get().map(|result| match result {
                Err(e) if is_auth_error(&e) => view! { <LoginPage/> }.into_any(),
                Ok(d) => view! { <DashboardShell data=d days=days set_days=set_days ga_cache=ga_cache/> }.into_any(),
                Err(e) => view! { <div class="container"><div class="error-text">{e.to_string()}</div></div> }.into_any(),
            })}
        </Suspense>
    }
}

#[component]
fn DashboardShell(
    data: DashboardData,
    days: ReadSignal<u64>,
    set_days: WriteSignal<u64>,
    ga_cache: DashboardGaCache,
) -> impl IntoView {
    let handle_logout = move |_| {
        leptos::task::spawn_local(async move {
            let _ = logout().await;
            let _ = leptos::prelude::window().location().set_href("/");
        });
    };

    view! {
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
            <DashboardContent data=data days=days.get() ga_cache=ga_cache/>
        </div>
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
    let ga_loading = RwSignal::new(!cached && !urls.is_empty());
    if !urls.is_empty() && !cached {
        Effect::new(move |_| {
            let urls = urls.clone();
            leptos::task::spawn_local(async move {
                if let Ok(map) = fetch_all_ga_sessions(urls, days).await {
                    ga_cache.set(Some((days, map)));
                }
                ga_loading.set(false);
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

    let count = data.properties.len();

    view! {
        <StatsGrid
            totals=data.totals
            label=label
            total_ga_sessions=total_ga_sessions
            ga_loading=ga_loading
        />
        <h2>{format!("Properties ({count})")}</h2>
        <PropertyTable properties=data.properties ga_map=ga_map/>
    }
}

#[component]
fn StatsGrid(
    totals: crate::api::GscMetrics,
    label: String,
    total_ga_sessions: Memo<Option<f64>>,
    ga_loading: RwSignal<bool>,
) -> impl IntoView {
    view! {
        <div class="stats-grid">
            <StatCard label="Impressions" value=format_number(totals.impressions) sub=label.clone()/>
            <StatCard label="Clicks" value=format_number(totals.clicks) sub=label/>
            <StatCard label="CTR" value=format_ctr(totals.ctr) sub=String::new()/>
            <StatCard label="Avg Position" value=format_position(totals.position) sub=String::new()/>
            <div class="stat-card">
                <div class="stat-label">"Sessions"</div>
                <div class="stat-value">{move || {
                    if ga_loading.get() {
                        view! { <div class="ga-spinner"></div> }.into_any()
                    } else {
                        view! { <span>{total_ga_sessions.get().map(format_number).unwrap_or_else(|| "-".into())}</span> }.into_any()
                    }
                }}</div>
                <div class="stat-sub color-teal">"Google Analytics"</div>
            </div>
        </div>
    }
}

#[component]
fn PropertyTable(
    properties: Vec<crate::api::PropertyData>,
    ga_map: Memo<HashMap<String, GaPropertyData>>,
) -> impl IntoView {
    view! {
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
                    {properties.into_iter().map(|p| {
                        view! { <PropertyRow property=p ga_map=ga_map/> }
                    }).collect::<Vec<_>>()}
                </tbody>
            </table>
        </div>
    }
}

#[component]
fn PropertyRow(
    property: crate::api::PropertyData,
    ga_map: Memo<HashMap<String, GaPropertyData>>,
) -> impl IntoView {
    let sparkline = build_sparkline_path(&property.daily, |r| r.impressions);
    let href = format!("/property/{}", urlencoding::encode(&property.site_url));
    let site_url = property.site_url.clone();
    let url_for_sessions = site_url.clone();
    let url_for_ga_spark = site_url.clone();

    let impressions_data: Vec<(String, f64)> = property
        .daily
        .iter()
        .map(|r| (r.date.clone(), r.impressions))
        .collect();
    let dates: Vec<String> = property.daily.iter().map(|r| r.date.clone()).collect();

    view! {
        <tr class="prop-row-link">
            <td class="prop-name"><a href={href.clone()} class="row-link">{clean_url(&property.site_url)}</a></td>
            <td class="num-cell"><a href={href.clone()} class="row-link">{format_number(property.impressions)}</a></td>
            <td class="num-cell"><a href={href.clone()} class="row-link">{format_number(property.clicks)}</a></td>
            <td class="num-cell"><a href={href.clone()} class="row-link">{format_ctr(property.ctr)}</a></td>
            <td class="num-cell"><a href={href.clone()} class="row-link">{format_position(property.position)}</a></td>
            <td class="num-cell ga-col">
                <a href={href.clone()} class="row-link color-teal">{
                    move || ga_map.get().get(&url_for_sessions).map(|d| format_number(d.total)).unwrap_or_else(|| "-".to_string())
                }</a>
            </td>
            <td class="sparkline-cell">
                <SparklineTooltip
                    href={href.clone()}
                    path={sparkline}
                    color="var(--accent)"
                    data={impressions_data}
                    label="Impressions"
                />
            </td>
            <td class="sparkline-cell">
                {
                    let href = href.clone();
                    let dates = dates.clone();
                    move || {
                        let ga = ga_map.get();
                        let ga_data = ga.get(&url_for_ga_spark);
                        match ga_data {
                            None => view! { <a href={href.clone()} class="row-link"><span></span></a> }.into_any(),
                            Some(d) => {
                                let path = build_sparkline_from_values(&d.daily);
                                if path.is_empty() {
                                    return view! { <a href={href.clone()} class="row-link"><span></span></a> }.into_any();
                                }
                                let data: Vec<(String, f64)> = dates.iter().zip(d.daily.iter())
                                    .map(|(date, val)| (date.clone(), *val))
                                    .collect();
                                view! {
                                    <SparklineTooltip
                                        href={href.clone()}
                                        path={path}
                                        color="var(--chart-teal)"
                                        data={data}
                                        label="Sessions"
                                    />
                                }.into_any()
                            }
                        }
                    }
                }
            </td>
        </tr>
    }
}

#[component]
fn SparklineTooltip(
    href: String,
    path: String,
    color: &'static str,
    data: Vec<(String, f64)>,
    label: &'static str,
) -> impl IntoView {
    let (hover_idx, set_hover_idx) = signal(Option::<usize>::None);
    let len = data.len();
    let data = StoredValue::new(data);

    let handle_mouse_move = move |ev: leptos::ev::MouseEvent| {
        if len == 0 { return; }
        let target = ev.current_target().unwrap();
        let el: web_sys::HtmlElement = target.unchecked_into();
        let w = el.offset_width() as f64;
        let x = ev.offset_x() as f64;
        if w <= 0.0 { return; }
        let ratio = (x / w).clamp(0.0, 1.0);
        let idx = (ratio * (len - 1) as f64).round() as usize;
        set_hover_idx.set(Some(idx.min(len - 1)));
    };

    let handle_mouse_leave = move |_: leptos::ev::MouseEvent| {
        set_hover_idx.set(None);
    };

    view! {
        <a href={href} class="row-link sparkline-tooltip-wrap"
            on:mousemove=handle_mouse_move
            on:mouseleave=handle_mouse_leave
        >
            <svg class="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
                <path d={path} fill="none" stroke={color} stroke-width="1.5"/>
            </svg>
            {move || {
                let idx = hover_idx.get()?;
                let items = data.get_value();
                let (date, val) = items.get(idx)?;
                let pct = if len > 1 { idx as f64 / (len - 1) as f64 * 100.0 } else { 50.0 };
                let align_right = pct > 50.0;
                Some(view! {
                    <div
                        class="sparkline-tip"
                        class:sparkline-tip-right=align_right
                        style:left=format!("{}%", pct)
                    >
                        <div class="tooltip-date">{date.clone()}</div>
                        <div class="tooltip-row">
                            <span class="tooltip-dot" style:background=color></span>
                            <span class="tooltip-label">{label}</span>
                            <span class="tooltip-val">{format_number(val.clone())}</span>
                        </div>
                    </div>
                })
            }}
        </a>
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
