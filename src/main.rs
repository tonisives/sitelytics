mod aeo;
mod api;
mod identity;
mod state;
mod worker;

use axum::{
    Router,
    extract::{Query, State},
    response::{IntoResponse, Json, Response},
};
use std::collections::HashMap;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sitelytics=info".into()),
        )
        .init();
    let state = state::AppState::from_env()
        .await
        .map_err(std::io::Error::other)?;
    if std::env::args().nth(1).as_deref() == Some("aeo-worker") {
        return worker::run(state)
            .await
            .map_err(std::io::Error::other)
            .map_err(Into::into);
    }
    let port = std::env::var("API_PORT").unwrap_or_else(|_| "19100".into());
    let addr = format!("0.0.0.0:{port}");

    let cors = CorsLayer::permissive();

    let app = Router::new()
        .route("/auth/google", axum::routing::get(identity::auth_google))
        .route(
            "/auth/callback",
            axum::routing::get(identity::auth_callback),
        )
        .route("/api/auth/logout", axum::routing::post(identity::logout))
        .route("/api/me", axum::routing::get(identity::me))
        .route("/api/gsc/dashboard", axum::routing::get(api_gsc_dashboard))
        .route("/api/gsc/property", axum::routing::get(api_gsc_property))
        .route("/api/gsc/dimension", axum::routing::get(api_gsc_dimension))
        .route("/api/ga/metric", axum::routing::get(api_ga_metric))
        .route("/api/ga/dashboard", axum::routing::post(api_ga_dashboard))
        .route(
            "/api/aeo/property",
            axum::routing::get(aeo::get_property).put(aeo::put_property),
        )
        .route(
            "/api/aeo/queries",
            axum::routing::get(aeo::list_queries).post(aeo::create_query),
        )
        .route(
            "/api/aeo/queries/{id}",
            axum::routing::patch(aeo::patch_query).delete(aeo::delete_query),
        )
        .route("/api/aeo/dashboard", axum::routing::post(aeo::dashboard))
        .route("/api/aeo/results", axum::routing::get(aeo::results))
        .route("/api/admin/usage", axum::routing::get(aeo::admin_usage))
        .layer(cors)
        .with_state(state);

    println!("API server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

#[derive(serde::Deserialize)]
struct DashboardQuery {
    days: Option<u64>,
}

async fn api_gsc_dashboard(
    State(state): State<state::AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<DashboardQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Ok(session) = identity::session(&state, &headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    match api::server::fetch_dashboard(&session.access_token, days).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct PropertyQuery {
    site_url: String,
    days: Option<u64>,
}

async fn api_gsc_property(
    State(state): State<state::AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<PropertyQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Ok(session) = identity::session(&state, &headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    let mut prop = match api::server::fetch_property(&session.access_token, &q.site_url, days).await
    {
        Ok(p) => p,
        Err(e) => return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    prop.ga_property_id =
        api::server::resolve_ga_property(&session.access_token, &q.site_url).await;
    Json(prop).into_response()
}

#[derive(serde::Deserialize)]
struct DimensionQuery {
    site_url: String,
    dimension: String,
    days: Option<u64>,
}

async fn api_gsc_dimension(
    State(state): State<state::AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<DimensionQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Ok(session) = identity::session(&state, &headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    match api::server::fetch_dimension(&session.access_token, &q.site_url, &q.dimension, days).await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct GaMetricQuery {
    site_url: String,
    days: Option<u64>,
    metric: String,
}

async fn api_ga_metric(
    State(state): State<state::AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<GaMetricQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Ok(session) = identity::session(&state, &headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    let property_id = api::server::resolve_ga_property(&session.access_token, &q.site_url).await;
    let Some(property_id) = property_id else {
        return Json(serde_json::Value::Null).into_response();
    };
    let daily = match api::server::fetch_ga_daily_metric(
        &session.access_token,
        &property_id,
        &q.metric,
        days,
    )
    .await
    {
        Ok(d) => d,
        Err(e) => return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    let total: f64 = daily.iter().map(|(_, s)| s).sum();
    let first_date = daily.first().map(|(d, _)| d.as_str()).unwrap_or("-");
    let last_date = daily.last().map(|(d, _)| d.as_str()).unwrap_or("-");
    eprintln!(
        "[ga-metric] site_url={:?} pid={property_id} metric={:?} rows={} total={total} range={first_date}..{last_date}",
        q.site_url,
        q.metric,
        daily.len()
    );
    let data = serde_json::json!({
        "property_id": property_id,
        "daily": daily,
        "total": total,
    });
    Json(data).into_response()
}

#[derive(serde::Deserialize)]
struct GaDashboardBody {
    site_urls: Vec<String>,
    days: Option<u64>,
}

async fn api_ga_dashboard(
    State(state): State<state::AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<GaDashboardBody>,
) -> Response {
    let days = body.days.unwrap_or(28);
    let Ok(session) = identity::session(&state, &headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };

    let ga_props = api::server::list_ga_props(&session.access_token).await;
    eprintln!(
        "[ga-dashboard] received {} site_urls: {:?}",
        body.site_urls.len(),
        body.site_urls
    );

    let mut tasks = tokio::task::JoinSet::new();
    for url in body.site_urls {
        let token = session.access_token.clone();
        let d = days;
        let pid = api::server::resolve_ga_from_list(&ga_props, &url);
        tasks.spawn(async move {
            if let Some(pid) = pid {
                let daily = api::server::fetch_ga_daily_sessions(&token, &pid, d).await;
                match &daily {
                    Ok(rows) => {
                        let first = rows.first().map(|(d, _)| d.as_str()).unwrap_or("-");
                        let last = rows.last().map(|(d, _)| d.as_str()).unwrap_or("-");
                        eprintln!(
                            "[ga-dashboard] url={url:?} pid={pid} rows={} range={first}..{last}",
                            rows.len()
                        );
                    }
                    Err(e) => eprintln!("[ga-dashboard] url={url:?} pid={pid} error={e}"),
                }
                if let Ok(rows) = daily {
                    let total: f64 = rows.iter().map(|(_, s)| s).sum();
                    let values: Vec<f64> = rows.iter().map(|(_, s)| *s).collect();
                    return Some((
                        url,
                        serde_json::json!({
                            "total": total,
                            "daily": values,
                            "daily_dated": rows,
                            "property_id": pid,
                        }),
                    ));
                }
            } else {
                eprintln!("[ga-dashboard] url={url:?} no GA match");
            }
            None
        });
    }

    let mut result = HashMap::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(Some((url, data))) = res {
            result.insert(url, data);
        }
    }

    Json(result).into_response()
}
