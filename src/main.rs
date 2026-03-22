mod api;

use axum::{
    Router,
    extract::Query,
    response::{AppendHeaders, IntoResponse, Json, Redirect, Response},
};
use std::collections::HashMap;
use tower_http::cors::{CorsLayer, Any};

fn with_cookie<T: IntoResponse>(session: &api::server::SessionData, body: T) -> Response {
    match &session.updated_cookie {
        Some(cookie) => {
            (AppendHeaders([(http::header::SET_COOKIE, cookie.clone())]), body).into_response()
        }
        None => body.into_response(),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("API_PORT").unwrap_or_else(|_| "19100".into());
    let addr = format!("0.0.0.0:{port}");

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/auth/google", axum::routing::get(auth_google))
        .route("/auth/callback", axum::routing::get(auth_callback))
        .route("/api/auth/logout", axum::routing::post(api_logout))
        .route("/api/gsc/dashboard", axum::routing::get(api_gsc_dashboard))
        .route("/api/gsc/property", axum::routing::get(api_gsc_property))
        .route("/api/gsc/dimension", axum::routing::get(api_gsc_dimension))
        .route("/api/ga/metric", axum::routing::get(api_ga_metric))
        .route("/api/ga/dashboard", axum::routing::post(api_ga_dashboard))
        .layer(cors);

    println!("API server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

async fn auth_google() -> Redirect {
    api::server::auth_google().await
}

async fn auth_callback(Query(params): Query<api::server::CallbackParams>) -> Response {
    api::server::auth_callback(Query(params)).await
}

async fn api_logout(
    headers: axum::http::HeaderMap,
) -> Response {
    let _ = &headers;
    let cookie_str = "gsc_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    (
        [(http::header::SET_COOKIE, cookie_str.to_string())],
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

#[derive(serde::Deserialize)]
struct DashboardQuery {
    days: Option<u64>,
}

async fn api_gsc_dashboard(
    headers: axum::http::HeaderMap,
    Query(q): Query<DashboardQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Some(session) = api::server::extract_session(&headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    match api::server::fetch_dashboard(&session.access_token, days).await {
        Ok(data) => with_cookie(&session, Json(data)),
        Err(e) => (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    }
}

#[derive(serde::Deserialize)]
struct PropertyQuery {
    site_url: String,
    days: Option<u64>,
}

async fn api_gsc_property(
    headers: axum::http::HeaderMap,
    Query(q): Query<PropertyQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Some(session) = api::server::extract_session(&headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    let mut prop = match api::server::fetch_property(&session.access_token, &q.site_url, days).await {
        Ok(p) => p,
        Err(e) => return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };
    prop.ga_property_id =
        api::server::resolve_ga_property(&session.access_token, &q.site_url).await;
    with_cookie(&session, Json(prop))
}

#[derive(serde::Deserialize)]
struct DimensionQuery {
    site_url: String,
    dimension: String,
    days: Option<u64>,
}

async fn api_gsc_dimension(
    headers: axum::http::HeaderMap,
    Query(q): Query<DimensionQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Some(session) = api::server::extract_session(&headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    match api::server::fetch_dimension(&session.access_token, &q.site_url, &q.dimension, days).await
    {
        Ok(rows) => with_cookie(&session, Json(rows)),
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
    headers: axum::http::HeaderMap,
    Query(q): Query<GaMetricQuery>,
) -> Response {
    let days = q.days.unwrap_or(28);
    let Some(session) = api::server::extract_session(&headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };
    let property_id = api::server::resolve_ga_property(&session.access_token, &q.site_url).await;
    let Some(property_id) = property_id else {
        return with_cookie(&session, Json(serde_json::Value::Null));
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
    eprintln!("[ga-metric] site_url={:?} pid={property_id} metric={:?} rows={} total={total}", q.site_url, q.metric, daily.len());
    let data = serde_json::json!({
        "property_id": property_id,
        "daily": daily,
        "total": total,
    });
    with_cookie(&session, Json(data))
}

#[derive(serde::Deserialize)]
struct GaDashboardBody {
    site_urls: Vec<String>,
    days: Option<u64>,
}

async fn api_ga_dashboard(
    headers: axum::http::HeaderMap,
    Json(body): Json<GaDashboardBody>,
) -> Response {
    let days = body.days.unwrap_or(28);
    let Some(session) = api::server::extract_session(&headers).await else {
        return (axum::http::StatusCode::UNAUTHORIZED, "Not authenticated").into_response();
    };

    let ga_props = api::server::list_ga_props(&session.access_token).await;
    eprintln!("[ga-dashboard] received {} site_urls: {:?}", body.site_urls.len(), body.site_urls);

    let mut tasks = tokio::task::JoinSet::new();
    for url in body.site_urls {
        let token = session.access_token.clone();
        let d = days;
        let pid = api::server::resolve_ga_from_list(&ga_props, &url);
        tasks.spawn(async move {
            if let Some(pid) = pid {
                let daily = api::server::fetch_ga_daily_sessions(&token, &pid, d).await;
                match &daily {
                    Ok(rows) => eprintln!("[ga-dashboard] url={url:?} pid={pid} rows={} data={rows:?}", rows.len()),
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

    with_cookie(&session, Json(result))
}
