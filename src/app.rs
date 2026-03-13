use crate::api::{DashboardData, DimensionRow};
use crate::pages::dashboard::DashboardPage;
use crate::pages::detail::{DetailPage, GaSessionsData};
use crate::pages::login::LoginPage;
use leptos::prelude::*;
use leptos_meta::*;
use leptos_router::{
    components::{Route, Router, Routes},
    path,
};
use std::collections::HashMap;

/// Cached dashboard data: (days, data)
pub type DashboardCache = RwSignal<Option<(u64, DashboardData)>>;

/// Cached dimension data: key is (site_url, dimension, days) -> rows
pub type DimensionCache = RwSignal<HashMap<(String, String, u64), Vec<DimensionRow>>>;

/// Cached detail page state: (site_url, days) -> PropertyData
pub type DetailCache = RwSignal<Option<(String, u64, crate::api::PropertyData)>>;

/// Cached GA data: key is (site_url, days, metric) -> GaSessionsData
pub type GaCache = RwSignal<HashMap<(String, u64, String), Option<GaSessionsData>>>;

/// Cached dashboard GA sessions: (days) -> per-property GA data
pub type DashboardGaCache =
    RwSignal<Option<(u64, HashMap<String, crate::pages::dashboard::GaPropertyData>)>>;

#[server(Logout, "/api")]
pub async fn logout() -> Result<(), ServerFnError> {
    use leptos_axum::ResponseOptions;

    let response = expect_context::<ResponseOptions>();
    let cookie_str = "gsc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    if let Ok(val) = cookie_str.parse() {
        response.insert_header(http::header::SET_COOKIE, val);
    }
    Ok(())
}

#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();

    let dashboard_cache: DashboardCache = RwSignal::new(None);
    provide_context(dashboard_cache);

    let detail_cache: DetailCache = RwSignal::new(None);
    provide_context(detail_cache);

    let dimension_cache: DimensionCache = RwSignal::new(HashMap::new());
    provide_context(dimension_cache);

    let ga_cache: GaCache = RwSignal::new(HashMap::new());
    provide_context(ga_cache);

    let dashboard_ga_cache: DashboardGaCache = RwSignal::new(None);
    provide_context(dashboard_ga_cache);

    view! {
        <Stylesheet id="leptos" href="/pkg/sitelytics.css"/>
        <Title text="Sitelytics"/>
        <Router>
            <Routes fallback=|| "Not found">
                <Route path=path!("/") view=DashboardPage/>
                <Route path=path!("/login") view=LoginPage/>
                <Route path=path!("/property/:site") view=DetailPage/>
            </Routes>
        </Router>
    }
}
