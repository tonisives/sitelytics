use crate::api::{DailyRow, DimensionRow, PropertyData};
use crate::app::{DashboardCache, DetailCache, DimensionCache};
use crate::pages::login::LoginPage;
use leptos::prelude::*;
use leptos_router::hooks::use_params_map;

#[server(FetchPropertyDetail, "/api")]
pub async fn fetch_property_detail(
    site_url: String,
    days: u64,
) -> Result<PropertyData, ServerFnError> {
    let req = expect_context::<http::request::Parts>();
    let session = crate::api::server::extract_session(&req.headers)
        .await
        .ok_or_else(|| ServerFnError::new("Not authenticated"))?;
    crate::api::server::apply_session_cookie(&session);
    let data = crate::api::server::fetch_dashboard(&session.access_token, days)
        .await
        .map_err(ServerFnError::new)?;
    data.properties
        .into_iter()
        .find(|p| p.site_url == site_url)
        .ok_or_else(|| ServerFnError::new("Property not found"))
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GaSessionsData {
    pub property_id: String,
    /// (date, value) pairs
    pub daily: Vec<(String, f64)>,
    pub total: f64,
}

/// Available GA metrics for the detail chart
pub const GA_METRICS: &[(&str, &str, &str)] = &[
    ("sessions", "Sessions", "var(--chart-teal)"),
    ("screenPageViews", "Pageviews", "var(--chart-pink)"),
    ("engagedSessions", "Engaged", "var(--chart-teal)"),
    ("bounceRate", "Bounce Rate", "var(--chart-pink)"),
    ("averageSessionDuration", "Avg Duration", "var(--chart-teal)"),
];

#[server(FetchGaSessions, "/api")]
pub async fn fetch_ga_sessions(
    site_url: String,
    days: u64,
    metric: String,
) -> Result<Option<GaSessionsData>, ServerFnError> {
    let req = expect_context::<http::request::Parts>();
    let session = crate::api::server::extract_session(&req.headers)
        .await
        .ok_or_else(|| ServerFnError::new("Not authenticated"))?;
    crate::api::server::apply_session_cookie(&session);

    let Some(property_id) =
        crate::api::server::resolve_ga_property(&session.access_token, &site_url).await
    else {
        eprintln!("[ga-detail] no property found for {}", site_url);
        return Ok(None);
    };

    eprintln!("[ga-detail] fetching {} for property {} ({})", metric, property_id, site_url);
    let daily =
        crate::api::server::fetch_ga_daily_metric(&session.access_token, &property_id, &metric, days)
            .await
            .map_err(ServerFnError::new)?;

    let total: f64 = daily.iter().map(|(_, s)| s).sum();
    eprintln!("[ga-detail] got {} daily rows, total={}", daily.len(), total);

    Ok(Some(GaSessionsData {
        property_id,
        daily,
        total,
    }))
}

#[server(FetchDimension, "/api")]
pub async fn fetch_dimension(
    site_url: String,
    dimension: String,
    days: u64,
) -> Result<Vec<DimensionRow>, ServerFnError> {
    let req = expect_context::<http::request::Parts>();
    let session = crate::api::server::extract_session(&req.headers)
        .await
        .ok_or_else(|| ServerFnError::new("Not authenticated"))?;
    crate::api::server::apply_session_cookie(&session);
    crate::api::server::fetch_dimension(&session.access_token, &site_url, &dimension, days)
        .await
        .map_err(ServerFnError::new)
}

#[component]
pub fn DetailPage() -> impl IntoView {
    let params = use_params_map();
    let site_url = move || {
        let encoded = params.read().get("site").unwrap_or_default();
        urlencoding::decode(&encoded)
            .map(std::borrow::Cow::into_owned)
            .unwrap_or(encoded)
    };

    let cache = expect_context::<DetailCache>();
    let dash_cache = expect_context::<DashboardCache>();
    let ga_cache = expect_context::<crate::app::GaCache>();
    let (days, set_days) = signal(28u64);

    // Active GA metric (None = off, Some("sessions") etc.)
    let (ga_metric, set_ga_metric) = signal(Option::<String>::None);
    let ga_data_sig = RwSignal::new(Option::<GaSessionsData>::None);
    let ga_loading = RwSignal::new(false);

    // Fetch GA data client-side when metric changes
    let ga_site_url_effect = {
        let site_url = site_url.clone();
        move || site_url()
    };
    Effect::new(move |_| {
        let metric = ga_metric.get();
        let Some(metric) = metric else {
            ga_data_sig.set(None);
            ga_loading.set(false);
            return;
        };
        let url = ga_site_url_effect();
        let d = days.get();
        let key = (url.clone(), d, metric.clone());

        // Check cache first
        if let Some(data) = ga_cache.get_untracked().get(&key) {
            ga_data_sig.set(data.clone());
            ga_loading.set(false);
            return;
        }

        ga_loading.set(true);
        leptos::task::spawn_local(async move {
            let result = fetch_ga_sessions(url.clone(), d, metric.clone()).await.ok().flatten();
            if let Some(ref data) = result {
                let cache_key = (url, d, metric);
                ga_cache.update(|m| { m.insert(cache_key, Some(data.clone())); });
            }
            ga_data_sig.set(result);
            ga_loading.set(false);
        });
    });

    let data = Resource::new(
        move || (site_url(), days.get()),
        move |(url, d)| {
            let detail_cached = cache.get_untracked();
            let dash_cached = dash_cache.get_untracked();
            async move {
                // Check detail cache first
                if let Some((ref cu, cd, ref cp)) = detail_cached {
                    if *cu == url && cd == d {
                        return Ok(cp.clone());
                    }
                }
                // Fall back to dashboard cache (has property data from listing)
                if let Some((cd, ref data)) = dash_cached {
                    if cd == d {
                        if let Some(prop) = data.properties.iter().find(|p| p.site_url == url) {
                            return Ok(prop.clone());
                        }
                    }
                }
                fetch_property_detail(url, d).await
            }
        },
    );

    Effect::new(move || {
        if let Some(Ok(prop)) = data.get() {
            cache.set(Some((site_url(), days.get_untracked(), prop)));
        }
    });

    let gsc_url = move || {
        let url = site_url();
        let encoded = urlencoding::encode(&url);
        format!("https://search.google.com/search-console/performance/search-analytics?resource_id={encoded}")
    };

    view! {
        <div class="container">
            <header class="dash-header">
                <div class="detail-title-row">
                    <a href="/" class="back-link">"< Back"</a>
                    <h1>{move || clean_url(&site_url())}</h1>
                    <a href={gsc_url} target="_blank" rel="noopener" class="gsc-link">"Open in GSC"</a>
                </div>
                <div class="day-buttons">
                    <DayButton days=days set_days=set_days value=7/>
                    <DayButton days=days set_days=set_days value=28/>
                    <DayButton days=days set_days=set_days value=90/>
                </div>
            </header>

            <Suspense fallback=|| view! { <div class="loading">"Loading..."</div> }>
                {move || data.get().map(|result| match result {
                    Err(e) if e.to_string().contains("Not authenticated") => view! { <LoginPage/> }.into_any(),
                    Ok(prop) => view! { <DetailContent prop=prop site_url=site_url() days=days.get() ga_data=ga_data_sig ga_loading=ga_loading ga_metric=ga_metric set_ga_metric=set_ga_metric/> }.into_any(),
                    Err(e) => view! { <div class="error-text">{e.to_string()}</div> }.into_any(),
                })}
            </Suspense>
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

struct MetricDef {
    key: &'static str,
    color: &'static str,
    accessor: fn(&DailyRow) -> f64,
}

const METRICS: &[MetricDef] = &[
    MetricDef {
        key: "clicks",
        color: "var(--green)",
        accessor: |r| r.clicks,
    },
    MetricDef {
        key: "impressions",
        color: "var(--accent)",
        accessor: |r| r.impressions,
    },
    MetricDef {
        key: "ctr",
        color: "var(--chart-orange)",
        accessor: |r| r.ctr,
    },
    MetricDef {
        key: "position",
        color: "var(--chart-purple)",
        accessor: |r| r.position,
    },
];

struct ChartLine {
    key: &'static str,
    color: &'static str,
    max_val: f64,
    /// Normalized Y values (0.0 = bottom, 1.0 = top) for dot positioning
    y_pcts: Vec<f64>,
}

#[component]
fn DetailContent(
    prop: PropertyData,
    site_url: String,
    days: u64,
    ga_data: RwSignal<Option<GaSessionsData>>,
    ga_loading: RwSignal<bool>,
    ga_metric: ReadSignal<Option<String>>,
    set_ga_metric: WriteSignal<Option<String>>,
) -> impl IntoView {
    let (show_clicks, set_show_clicks) = signal(true);
    let (show_impressions, set_show_impressions) = signal(true);
    let (show_ctr, set_show_ctr) = signal(false);
    let (show_position, set_show_position) = signal(false);

    let show_ga = move || ga_metric.get().is_some();
    let ga_color = move || {
        let metric = ga_metric.get();
        GA_METRICS.iter()
            .find(|(k, _, _)| Some(k.to_string()) == metric)
            .map_or("var(--chart-teal)", |(_, _, c)| c)
            .to_string()
    };

    let daily = prop.daily.clone();

    // Compute the merged date axis: GSC dates + any extra GA dates beyond GSC range
    let gsc_dates: Vec<String> = daily.iter().map(|r| r.date.clone()).collect();
    let gsc_date_count = gsc_dates.len();

    // Extra GA dates that extend beyond the GSC range (reactive, updates when GA loads)
    let gsc_dates_for_merge = gsc_dates.clone();
    let extra_ga_dates = Memo::new(move |_| -> Vec<String> {
        let Some(ref ga) = ga_data.get() else {
            return Vec::new();
        };
        let gsc_set: std::collections::HashSet<&str> =
            gsc_dates_for_merge.iter().map(String::as_str).collect();
        let last_gsc = gsc_dates_for_merge.last().map(String::as_str).unwrap_or("");
        let mut extra: Vec<String> = ga
            .daily
            .iter()
            .filter(|(d, _)| !gsc_set.contains(d.as_str()) && d.as_str() > last_gsc)
            .map(|(d, _)| d.clone())
            .collect();
        extra.sort();
        extra
    });

    // Total number of days on the chart - only extend when a GA metric is visible
    let num_days = Memo::new(move |_| {
        if show_ga() {
            gsc_date_count + extra_ga_dates.get().len()
        } else {
            gsc_date_count
        }
    });

    // Build GSC chart lines - these only cover gsc_date_count points
    // but are scaled to the full num_days width
    let gsc_line_count = gsc_date_count;
    let lines: Vec<ChartLine> = METRICS
        .iter()
        .map(|m| {
            let values: Vec<f64> = daily.iter().map(m.accessor).collect();
            let max_val = values.iter().cloned().fold(0.0f64, f64::max);
            let safe_max = if max_val == 0.0 { 1.0 } else { max_val };
            let y_pcts: Vec<f64> = values
                .iter()
                .map(|v| v / safe_max * 0.9 + 0.05)
                .collect();
            ChartLine {
                key: m.key,
                color: m.color,
                max_val,
                y_pcts,
            }
        })
        .collect();

    // Build GSC SVG paths reactively so they scale to the full date axis
    let gsc_paths: Vec<Memo<String>> = lines
        .iter()
        .map(|line| {
            let y_pcts = line.y_pcts.clone();
            Memo::new(move |_| {
                let total = num_days.get();
                build_scaled_chart_path(&y_pcts, total)
            })
        })
        .collect();

    // Fixed axes: clicks on left, impressions on right
    let clicks_max = lines.iter().find(|l| l.key == "clicks").map_or(0.0, |l| l.max_val);
    let impressions_max = lines.iter().find(|l| l.key == "impressions").map_or(0.0, |l| l.max_val);

    let clicks_max_label = format_axis_number(clicks_max);
    let clicks_mid_label = format_axis_number(clicks_max / 2.0);
    let impressions_max_label = format_axis_number(impressions_max);
    let impressions_mid_label = format_axis_number(impressions_max / 2.0);

    // Build GA sessions chart data over the full merged date axis
    let gsc_dates_for_ga = gsc_dates.clone();
    let ga_chart = Memo::new(move |_| {
        let Some(ref ga) = ga_data.get() else {
            return None;
        };
        let ga_by_date: std::collections::HashMap<&str, f64> =
            ga.daily.iter().map(|(d, s)| (d.as_str(), *s)).collect();
        // Build values over the full merged date axis
        let extra = extra_ga_dates.get();
        let mut values: Vec<f64> = gsc_dates_for_ga
            .iter()
            .map(|d| ga_by_date.get(d.as_str()).copied().unwrap_or(0.0))
            .collect();
        for d in &extra {
            values.push(ga_by_date.get(d.as_str()).copied().unwrap_or(0.0));
        }
        let total_days = values.len();
        let max_val = values.iter().cloned().fold(0.0f64, f64::max);
        let safe_max = if max_val == 0.0 { 1.0 } else { max_val };
        let y_pcts: Vec<f64> = values
            .iter()
            .map(|v| v / safe_max * 0.9 + 0.05)
            .collect();
        let path = build_scaled_chart_path(&y_pcts, total_days);
        Some((path, max_val, y_pcts, values))
    });

    let ga_total = Memo::new(move |_| {
        ga_data.get().map(|g| g.total)
    });

    let stats = vec![
        ("Clicks", format_number(prop.clicks)),
        ("Impressions", format_number(prop.impressions)),
        ("CTR", format_ctr(prop.ctr)),
        ("Avg Position", format_position(prop.position)),
    ];

    // Hover state
    let (hover_idx, set_hover_idx) = signal(Option::<usize>::None);

    // All dates for tooltip (reactive)
    let daily_for_tooltip = prop.daily.clone();
    let tooltip_content = move || {
        let idx = hover_idx.get()?;
        let extra = extra_ga_dates.get();
        if idx < gsc_date_count {
            let row = daily_for_tooltip.get(idx)?;
            Some((row.date.clone(), Some(row.clicks), Some(row.impressions), Some(row.ctr), Some(row.position)))
        } else {
            let extra_idx = idx - gsc_date_count;
            let date = extra.get(extra_idx)?.clone();
            Some((date, None, None, None, None))
        }
    };

    let (chart_width, set_chart_width) = signal(1.0f64);
    let chart_ref = NodeRef::<leptos::html::Div>::new();
    let handle_mouse_move = move |ev: leptos::ev::MouseEvent| {
        let x = ev.offset_x() as f64;
        if let Some(el) = chart_ref.get() {
            let w = el.offset_width() as f64;
            if w > 0.0 {
                set_chart_width.set(w);
            }
        }
        let w = chart_width.get();
        let nd = num_days.get();
        if w <= 0.0 || nd == 0 {
            set_hover_idx.set(None);
            return;
        }
        let ratio = (x / w).clamp(0.0, 1.0);
        let idx = (ratio * (nd as f64 - 1.0)).round() as usize;
        let idx = idx.min(nd - 1);
        set_hover_idx.set(Some(idx));
    };

    let handle_mouse_leave = move |_: leptos::ev::MouseEvent| {
        set_hover_idx.set(None);
    };

    // Crosshair X position as percentage
    let crosshair_pct = move || {
        let idx = hover_idx.get()?;
        let nd = num_days.get();
        if nd <= 1 { return Some(0.0); }
        Some(idx as f64 / (nd - 1) as f64 * 100.0)
    };

    view! {
        <div class="stats-grid">
            {stats.into_iter().map(|(label, value)| view! {
                <div class="stat-card">
                    <div class="stat-label">{label}</div>
                    <div class="stat-value">{value}</div>
                </div>
            }).collect::<Vec<_>>()}
            <Show when=move || ga_total.get().is_some()>
                <div class="stat-card">
                    <div class="stat-label">{
                        move || {
                            let metric = ga_metric.get();
                            GA_METRICS.iter()
                                .find(|(k, _, _)| Some(k.to_string()) == metric)
                                .map_or("GA", |(_, l, _)| l)
                                .to_string()
                        }
                    }</div>
                    <div class="stat-value">{move || {
                        let total = ga_total.get().unwrap_or(0.0);
                        match ga_metric.get().as_deref() {
                            Some("bounceRate") => format!("{:.1}%", total / ga_data.get().map_or(1.0, |g| g.daily.len() as f64) * 100.0),
                            Some("averageSessionDuration") => {
                                let count = ga_data.get().map_or(1.0, |g| g.daily.len() as f64);
                                format!("{:.0}s", total / count)
                            }
                            _ => format_number(total),
                        }
                    }}</div>
                </div>
            </Show>
        </div>

        <div class="chart-card">
            <div class="chart-toggles-row">
                <div class="chart-toggles">
                    <MetricToggle label="Clicks" color="var(--green)" active=show_clicks set_active=set_show_clicks/>
                    <MetricToggle label="Impressions" color="var(--accent)" active=show_impressions set_active=set_show_impressions/>
                    <MetricToggle label="CTR" color="var(--chart-orange)" active=show_ctr set_active=set_show_ctr/>
                    <MetricToggle label="Position" color="var(--chart-purple)" active=show_position set_active=set_show_position/>
                </div>
                <div class="chart-toggles ga-toggles">
                    <span class="ga-loading" style:display=move || if ga_loading.get() { "inline" } else { "none" }>"Loading GA..."</span>
                    {GA_METRICS.iter().map(|(key, label, color)| {
                        let key = key.to_string();
                        let key_for_check = key.clone();
                        let key_for_click = key.clone();
                        let color = color.to_string();
                        let color_c = color.clone();
                        let key_for_bg = key.clone();
                        view! {
                            <button
                                class="metric-toggle"
                                class:metric-toggle-active=move || ga_metric.get().as_deref() == Some(&key_for_check)
                                style:border-color=color.clone()
                                style:background-color=move || if ga_metric.get().as_deref() == Some(&key_for_bg) { color_c.clone() } else { "transparent".into() }
                                on:click=move |_| {
                                    if ga_metric.get().as_deref() == Some(&key_for_click) {
                                        set_ga_metric.set(None);
                                    } else {
                                        set_ga_metric.set(Some(key_for_click.clone()));
                                    }
                                }
                            >
                                {*label}
                            </button>
                        }
                    }).collect::<Vec<_>>()}
                </div>
            </div>

            <div class="chart-axis-labels">
                <span class="axis-title color-green" style:display=move || if show_clicks.get() { "block" } else { "none" }>"Clicks"</span>
                <span class="axis-title-spacer"></span>
                <span class="axis-title color-accent" style:display=move || if show_impressions.get() { "block" } else { "none" }>"Impressions"</span>
            </div>

            <div class="chart-container">
                // Left axis: Clicks (green)
                <div class="chart-axis chart-axis-left"
                    style:visibility=move || if show_clicks.get() { "visible" } else { "hidden" }
                >
                    <span class="axis-label color-green">{clicks_max_label}</span>
                    <span class="axis-label color-green">{clicks_mid_label}</span>
                    <span class="axis-label color-green">"0"</span>
                </div>

                <div class="chart-area"
                    node_ref=chart_ref
                    on:mousemove=handle_mouse_move
                    on:mouseleave=handle_mouse_leave
                >
                    <svg class="full-chart" viewBox="0 0 800 200" preserveAspectRatio="none">
                        // Grid lines
                        <line x1="0" y1="10" x2="800" y2="10" stroke="var(--border)" stroke-width="0.5" style="vector-effect: non-scaling-stroke"/>
                        <line x1="0" y1="100" x2="800" y2="100" stroke="var(--border)" stroke-width="0.5" style="vector-effect: non-scaling-stroke"/>
                        <line x1="0" y1="190" x2="800" y2="190" stroke="var(--border)" stroke-width="0.5" style="vector-effect: non-scaling-stroke"/>

                        {lines.iter().zip(gsc_paths.iter()).map(|(c, path_memo)| {
                            let color_stroke = c.color.to_string();
                            let color_fill = c.color.to_string();
                            let path_memo = *path_memo;
                            let n = c.y_pcts.len();
                            let key = c.key;
                            let is_visible = move || match key {
                                "clicks" => show_clicks.get(),
                                "impressions" => show_impressions.get(),
                                "ctr" => show_ctr.get(),
                                "position" => show_position.get(),
                                _ => false,
                            };
                            // Close fill at last GSC data point, not at x=800
                            let fill_close = move || {
                                let total = num_days.get();
                                let last_x = if total > 1 && n > 0 {
                                    (n - 1) as f64 / (total - 1) as f64 * 800.0
                                } else {
                                    0.0
                                };
                                format!("{} L{last_x:.1},200 L0,200 Z", path_memo.get())
                            };
                            view! {
                                <g style:display=move || if is_visible() { "block" } else { "none" }>
                                    <path d=fill_close fill={color_fill} opacity="0.08"/>
                                    <path d=move || path_memo.get() fill="none" stroke={color_stroke} stroke-width="2"
                                        style="vector-effect: non-scaling-stroke"/>
                                </g>
                            }
                        }).collect::<Vec<_>>()}

                        // GA metric line
                        {move || {
                            if !show_ga() { return None; }
                            let (ref path, _, _, _) = ga_chart.get()?;
                            let color = ga_color();
                            let fill_path = format!("{path} L800,200 L0,200 Z");
                            let path = path.clone();
                            let color2 = color.clone();
                            Some(view! {
                                <g>
                                    <path d={fill_path} fill={color} opacity="0.08"/>
                                    <path d={path} fill="none" stroke={color2} stroke-width="2"
                                        style="vector-effect: non-scaling-stroke"/>
                                </g>
                            })
                        }}
                    </svg>

                    // Crosshair line
                    <div class="chart-crosshair"
                        style:display=move || if hover_idx.get().is_some() { "block" } else { "none" }
                        style:left=move || format!("{}%", crosshair_pct().unwrap_or(0.0))
                    ></div>

                    // Hover dots on each visible GSC line
                    {lines.iter().map(|line| {
                        let y_pcts = line.y_pcts.clone();
                        let color = line.color.to_string();
                        let key = line.key;
                        let is_visible = move || match key {
                            "clicks" => show_clicks.get(),
                            "impressions" => show_impressions.get(),
                            "ctr" => show_ctr.get(),
                            "position" => show_position.get(),
                            _ => false,
                        };
                        view! {
                            <div
                                class="chart-dot"
                                style:display=move || {
                                    let idx = hover_idx.get();
                                    let in_gsc_range = idx.is_some_and(|i| i < gsc_line_count);
                                    if in_gsc_range && is_visible() { "block" } else { "none" }
                                }
                                style:left=move || format!("{}%", crosshair_pct().unwrap_or(0.0))
                                style:top=move || {
                                    let idx = hover_idx.get().unwrap_or(0);
                                    let y = y_pcts.get(idx).copied().unwrap_or(0.5);
                                    format!("{}%", (1.0 - y) * 100.0)
                                }
                                style:background=color
                            ></div>
                        }
                    }).collect::<Vec<_>>()}

                    // GA metric hover dot
                    <div
                        class="chart-dot"
                        style:display=move || {
                            if hover_idx.get().is_some() && show_ga() && ga_chart.get().is_some() {
                                "block"
                            } else {
                                "none"
                            }
                        }
                        style:left=move || format!("{}%", crosshair_pct().unwrap_or(0.0))
                        style:top=move || {
                            let idx = hover_idx.get().unwrap_or(0);
                            let y = ga_chart.get()
                                .and_then(|(_, _, ref y_pcts, _)| y_pcts.get(idx).copied())
                                .unwrap_or(0.5);
                            format!("{}%", (1.0 - y) * 100.0)
                        }
                        style:background=ga_color
                    ></div>

                    // Tooltip
                    {move || {
                        tooltip_content().map(|(date, clicks, impressions, ctr, position)| {
                            let pct = crosshair_pct().unwrap_or(0.0);
                            let align_right = pct > 70.0;
                            view! {
                                <div class="chart-tooltip"
                                    class:tooltip-right=align_right
                                    style:left=format!("{}%", pct)
                                >
                                    <div class="tooltip-date">{date}</div>
                                    <Show when=move || show_clicks.get() && clicks.is_some()>
                                        <div class="tooltip-row">
                                            <span class="tooltip-dot" style="background: var(--green)"></span>
                                            <span class="tooltip-label">"Clicks"</span>
                                            <span class="tooltip-val">{format_tip_number(clicks.unwrap_or(0.0))}</span>
                                        </div>
                                    </Show>
                                    <Show when=move || show_impressions.get() && impressions.is_some()>
                                        <div class="tooltip-row">
                                            <span class="tooltip-dot" style="background: var(--accent)"></span>
                                            <span class="tooltip-label">"Impressions"</span>
                                            <span class="tooltip-val">{format_tip_number(impressions.unwrap_or(0.0))}</span>
                                        </div>
                                    </Show>
                                    <Show when=move || show_ctr.get() && ctr.is_some()>
                                        <div class="tooltip-row">
                                            <span class="tooltip-dot" style="background: var(--chart-orange)"></span>
                                            <span class="tooltip-label">"CTR"</span>
                                            <span class="tooltip-val">{format_ctr(ctr.unwrap_or(0.0))}</span>
                                        </div>
                                    </Show>
                                    <Show when=move || show_position.get() && position.is_some()>
                                        <div class="tooltip-row">
                                            <span class="tooltip-dot" style="background: var(--chart-purple)"></span>
                                            <span class="tooltip-label">"Position"</span>
                                            <span class="tooltip-val">{format_position(position.unwrap_or(0.0))}</span>
                                        </div>
                                    </Show>
                                    <Show when=move || show_ga() && ga_chart.get().is_some()>
                                        <div class="tooltip-row">
                                            <span class="tooltip-dot" style:background=ga_color></span>
                                            <span class="tooltip-label">{
                                                move || {
                                                    let metric = ga_metric.get();
                                                    GA_METRICS.iter()
                                                        .find(|(k, _, _)| Some(k.to_string()) == metric)
                                                        .map_or("GA", |(_, l, _)| l)
                                                        .to_string()
                                                }
                                            }</span>
                                            <span class="tooltip-val">{
                                                move || {
                                                    let idx = hover_idx.get().unwrap_or(0);
                                                    ga_chart.get()
                                                        .and_then(|(_, _, _, ref vals)| vals.get(idx).copied())
                                                        .map(|v| {
                                                            let metric = ga_metric.get();
                                                            match metric.as_deref() {
                                                                Some("bounceRate") => format!("{:.1}%", v * 100.0),
                                                                Some("averageSessionDuration") => format!("{:.0}s", v),
                                                                _ => format_tip_number(v),
                                                            }
                                                        })
                                                        .unwrap_or_default()
                                                }
                                            }</span>
                                        </div>
                                    </Show>
                                </div>
                            }
                        })
                    }}
                </div>

                // Right axis: Impressions (blue)
                <div class="chart-axis chart-axis-right"
                    style:visibility=move || if show_impressions.get() { "visible" } else { "hidden" }
                >
                    <span class="axis-label color-accent">{impressions_max_label}</span>
                    <span class="axis-label color-accent">{impressions_mid_label}</span>
                    <span class="axis-label color-accent">"0"</span>
                </div>
            </div>
        </div>

        <DimensionTabs site_url=site_url days=days/>
    }
}

const DIMENSION_TABS: &[(&str, &str)] = &[
    ("query", "Queries"),
    ("page", "Pages"),
    ("country", "Countries"),
    ("device", "Devices"),
];

#[component]
fn DimensionTabs(site_url: String, days: u64) -> impl IntoView {
    let (active_tab, set_active_tab) = signal("query".to_string());
    let dim_cache = expect_context::<DimensionCache>();

    let site_for_resource = site_url.clone();
    let site_for_effect = site_url.clone();
    let dim_data = Resource::new(
        move || (site_for_resource.clone(), active_tab.get(), days),
        move |(url, dim, d)| {
            let cached = dim_cache.get_untracked();
            async move {
                let key = (url.clone(), dim.clone(), d);
                if let Some(rows) = cached.get(&key) {
                    return Ok(rows.clone());
                }
                fetch_dimension(url, dim, d).await
            }
        },
    );

    Effect::new(move || {
        if let Some(Ok(rows)) = dim_data.get() {
            let key = (
                site_for_effect.clone(),
                active_tab.get_untracked(),
                days,
            );
            dim_cache.update(|m| {
                m.insert(key, rows);
            });
        }
    });

    view! {
        <div class="chart-card">
            <div class="dim-tabs">
                {DIMENSION_TABS.iter().map(|(key, label)| {
                    let key_owned = (*key).to_string();
                    let key_check = (*key).to_string();
                    let handle_click = move |_| set_active_tab.set(key_owned.clone());
                    view! {
                        <button
                            class="dim-tab"
                            class:dim-tab-active=move || active_tab.get() == key_check
                            on:click=handle_click
                        >
                            {*label}
                        </button>
                    }
                }).collect::<Vec<_>>()}
            </div>

            <Suspense fallback=|| view! { <div class="loading">"Loading..."</div> }>
                {move || dim_data.get().map(|result| match result {
                    Ok(rows) => {
                        let tab = active_tab.get();
                        let col_label = match tab.as_str() {
                            "query" => "Query",
                            "page" => "Page",
                            "country" => "Country",
                            "device" => "Device",
                            _ => "Key",
                        };
                        view! { <DimensionTable rows=rows col_label=col_label/> }.into_any()
                    }
                    Err(e) => view! { <div class="error-text">{e.to_string()}</div> }.into_any(),
                })}
            </Suspense>
        </div>
    }
}

#[component]
fn DimensionTable(rows: Vec<DimensionRow>, col_label: &'static str) -> impl IntoView {
    view! {
        <div class="table-card">
            <table class="prop-table">
                <thead>
                    <tr>
                        <th>{col_label}</th>
                        <th class="num-cell">"Clicks"</th>
                        <th class="num-cell">"Impressions"</th>
                        <th class="num-cell">"CTR"</th>
                        <th class="num-cell">"Position"</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.into_iter().map(|row| {
                        view! {
                            <tr>
                                <td class="prop-name dim-key">{row.key}</td>
                                <td class="num-cell color-green">{format_number(row.clicks)}</td>
                                <td class="num-cell color-accent">{format_number(row.impressions)}</td>
                                <td class="num-cell">{format_ctr(row.ctr)}</td>
                                <td class="num-cell">{format_position(row.position)}</td>
                            </tr>
                        }
                    }).collect::<Vec<_>>()}
                </tbody>
            </table>
        </div>
    }
}

#[component]
fn MetricToggle(
    label: &'static str,
    color: &'static str,
    active: ReadSignal<bool>,
    set_active: WriteSignal<bool>,
) -> impl IntoView {
    let color_owned = color.to_string();
    let handle_click = move |_| set_active.set(!active.get());

    view! {
        <button
            class="metric-toggle"
            class:metric-toggle-active=move || active.get()
            style:border-color=color_owned.clone()
            style:background-color=move || if active.get() { color_owned.clone() } else { "transparent".into() }
            on:click=handle_click
        >
            {label}
        </button>
    }
}

pub fn build_sparkline_path(daily: &[DailyRow], accessor: fn(&DailyRow) -> f64) -> String {
    if daily.is_empty() {
        return String::new();
    }
    let values: Vec<f64> = daily.iter().map(accessor).collect();
    let max = values.iter().cloned().fold(0.0f64, f64::max);
    let max = if max == 0.0 { 1.0 } else { max };
    let w = 80.0;
    let h = 24.0;
    let step = if values.len() > 1 {
        w / (values.len() - 1) as f64
    } else {
        0.0
    };

    values
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let x = i as f64 * step;
            let y = h - (v / max * h);
            if i == 0 {
                format!("M{x:.1},{y:.1}")
            } else {
                format!("L{x:.1},{y:.1}")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build an SVG path from pre-normalized y_pcts, scaled to `total_days` on the x-axis.
/// `y_pcts` may be shorter than `total_days` (e.g. GSC lines stop before GA-only dates).
fn build_scaled_chart_path(y_pcts: &[f64], total_days: usize) -> String {
    if y_pcts.is_empty() || total_days == 0 {
        return String::new();
    }
    let w = 800.0;
    let h = 200.0;
    let step = if total_days > 1 {
        w / (total_days - 1) as f64
    } else {
        0.0
    };

    y_pcts
        .iter()
        .enumerate()
        .map(|(i, y)| {
            let x = i as f64 * step;
            let yy = h - (y * h);
            if i == 0 {
                format!("M{x:.1},{yy:.1}")
            } else {
                format!("L{x:.1},{yy:.1}")
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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

fn format_tip_number(n: f64) -> String {
    let n = n as i64;
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{},{}",  n / 1_000, format!("{:03}", n % 1_000).trim_end_matches('0'))
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

fn format_axis_number(n: f64) -> String {
    let n = n as i64;
    if n >= 1_000_000 {
        format!("{:.0}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.0}K", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

