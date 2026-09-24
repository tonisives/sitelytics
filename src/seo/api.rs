use super::{Config, MODULES};
use crate::{identity, state::AppState};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;
type ApiResult = Result<Json<Value>, (StatusCode, String)>;
#[allow(clippy::needless_pass_by_value)] // map_err adapter owns its error.
fn db_error(e: sqlx::Error) -> (StatusCode, String) {
    tracing::error!(%e,"SEO database error");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "SEO storage unavailable".into(),
    )
}
#[allow(clippy::needless_pass_by_value)] // map_err adapter owns its error.
fn bad(e: impl ToString) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, e.to_string())
}
async fn admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<identity::SessionData, (StatusCode, String)> {
    let session = identity::session(state, headers)
        .await
        .map_err(|s| (s, "Not authenticated".into()))?;
    if !session.user.is_admin {
        return Err((
            StatusCode::FORBIDDEN,
            "SEO pilot is available to administrators".into(),
        ));
    }
    Ok(session)
}
async fn property_access(
    state: &AppState,
    session: &identity::SessionData,
    site: &str,
) -> Result<(), (StatusCode, String)> {
    let response = state
        .http
        .get("https://www.googleapis.com/webmasters/v3/sites")
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_GATEWAY,
                "Could not verify Google property access".into(),
            )
        })?;
    if !response.status().is_success() {
        return Err((
            StatusCode::FORBIDDEN,
            "Reconnect Google to verify property access".into(),
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| bad("Invalid Google response"))?;
    if !value["siteEntry"].as_array().is_some_and(|rows| {
        rows.iter()
            .any(|r| r["siteUrl"] == site && r["permissionLevel"] != "siteUnverifiedUser")
    }) {
        return Err((
            StatusCode::FORBIDDEN,
            "No access to this GSC property".into(),
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct SiteQuery {
    site_url: String,
}
#[derive(Deserialize)]
pub struct SaveInput {
    site_url: String,
    config: Config,
}
#[derive(Deserialize)]
pub struct RunInput {
    site_url: String,
    module: String,
}
pub async fn get_site(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SiteQuery>,
) -> ApiResult {
    let session = admin(&state, &headers).await?;
    let row = sqlx::query("SELECT id,config FROM seo_sites WHERE user_id=$1 AND site_url=$2")
        .bind(session.user.id)
        .bind(&q.site_url)
        .fetch_optional(&state.db)
        .await
        .map_err(db_error)?;
    let Some(row) = row else {
        property_access(&state, &session, &q.site_url).await?;
        return Ok(Json(
            json!({"config":Config::initial(&q.site_url),"jobs":[]}),
        ));
    };
    let id: Uuid = row.get("id");
    let jobs:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(j) - 'config' FROM (SELECT id,module,status,CASE WHEN id IN (SELECT DISTINCT ON (module) id FROM seo_jobs WHERE site_id=$1 AND status IN ('succeeded','partial') ORDER BY module,created_at DESC) THEN result ELSE NULL END AS result,error,created_at,started_at,completed_at FROM seo_jobs WHERE site_id=$1 ORDER BY created_at DESC LIMIT 80) j").bind(id).fetch_all(&state.db).await.map_err(db_error)?;
    let health: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(h) || jsonb_build_object('backlog',(SELECT count(*) FROM seo_jobs WHERE status IN ('queued','running','waiting_browser')),'oldest_pending',(SELECT min(created_at) FROM seo_jobs WHERE status IN ('queued','running','waiting_browser')),'last_success',(SELECT max(completed_at) FROM seo_jobs WHERE status='succeeded'),'failures_24h',(SELECT count(*) FROM seo_jobs WHERE status='failed' AND completed_at>now()-interval '24 hours')) FROM seo_worker_health h")
        .fetch_all(&state.db)
        .await
        .map_err(db_error)?;
    Ok(Json(
        json!({"config":row.get::<Value,_>("config"),"jobs":jobs,"workers":health}),
    ))
}
pub async fn save_site(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut input): Json<SaveInput>,
) -> ApiResult {
    let session = admin(&state, &headers).await?;
    input.config.validate(&input.site_url).map_err(bad)?;
    property_access(&state, &session, &input.site_url).await?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let id:Uuid=sqlx::query_scalar("INSERT INTO seo_sites(user_id,site_url,config) VALUES($1,$2,$3) ON CONFLICT(user_id,site_url) DO UPDATE SET config=EXCLUDED.config,updated_at=now() RETURNING id").bind(session.user.id).bind(&input.site_url).bind(json!(input.config)).fetch_one(&mut *tx).await.map_err(db_error)?;
    for module in MODULES {
        if !input.config.enabled(module) {
            sqlx::query("UPDATE seo_jobs SET status='cancelled',completed_at=now() WHERE site_id=$1 AND module=$2 AND status IN ('queued','running','waiting_browser')").bind(id).bind(module).execute(&mut *tx).await.map_err(db_error)?;
        }
        if input
            .config
            .modules
            .get(module)
            .is_some_and(|m| m.enabled && m.weekly)
        {
            sqlx::query(
                "INSERT INTO seo_schedules(site_id,module) VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(id)
            .bind(module)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        } else {
            sqlx::query("DELETE FROM seo_schedules WHERE site_id=$1 AND module=$2")
                .bind(id)
                .bind(module)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
        }
    }
    tx.commit().await.map_err(db_error)?;
    Ok(Json(json!({"config":input.config})))
}
pub async fn run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<RunInput>,
) -> ApiResult {
    let session = admin(&state, &headers).await?;
    if !MODULES.contains(&input.module.as_str()) {
        return Err(bad("Unknown module"));
    }
    property_access(&state, &session, &input.site_url).await?;
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let row =
        sqlx::query("SELECT id,config FROM seo_sites WHERE user_id=$1 AND site_url=$2 FOR UPDATE")
            .bind(session.user.id)
            .bind(input.site_url)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
            .ok_or_else(|| bad("Save site settings first"))?;
    let config: Value = row.get("config");
    let typed: Config = serde_json::from_value(config.clone()).map_err(bad)?;
    if !typed.enabled(&input.module) {
        return Err(bad("Enable this module first"));
    }
    if input.module == "rankings" && typed.keywords.is_empty() {
        return Err(bad("Save at least one keyword"));
    }
    let site: Uuid = row.get("id");
    let id:Uuid=sqlx::query_scalar("INSERT INTO seo_jobs(site_id,module,config) VALUES($1,$2,$3) ON CONFLICT(site_id,module) WHERE status IN ('queued','running','waiting_browser') DO UPDATE SET site_id=EXCLUDED.site_id RETURNING id").bind(site).bind(input.module).bind(config).fetch_one(&mut *tx).await.map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;
    Ok(Json(json!({"id":id})))
}
pub async fn cancel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    let session = admin(&state, &headers).await?;
    let n=sqlx::query("UPDATE seo_jobs j SET status='cancelled',completed_at=now() FROM seo_sites s WHERE j.id=$1 AND j.site_id=s.id AND s.user_id=$2 AND j.status IN ('queued','running','waiting_browser')").bind(id).bind(session.user.id).execute(&state.db).await.map_err(db_error)?;
    if n.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "Active job not found".into()));
    }
    Ok(Json(json!({"ok":true})))
}
pub async fn summary(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let session = admin(&state, &headers).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('site_url',s.site_url,'keywords',jsonb_array_length(s.config->'keywords'),'enabled',s.config->'modules','last_success',(SELECT max(completed_at) FROM seo_jobs WHERE site_id=s.id AND status='succeeded'),'issues',(SELECT result->'issue_count' FROM seo_jobs WHERE site_id=s.id AND module='audit' AND status IN ('succeeded','partial') ORDER BY created_at DESC LIMIT 1)) FROM seo_sites s WHERE s.user_id=$1").bind(session.user.id).fetch_all(&state.db).await.map_err(db_error)?;
    Ok(Json(json!(rows)))
}
pub async fn health(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(e) = admin(&state, &headers).await {
        return e.into_response();
    }
    let result: Result<Vec<Value>, _> =
        sqlx::query_scalar("SELECT to_jsonb(h) || jsonb_build_object('backlog',(SELECT count(*) FROM seo_jobs WHERE status IN ('queued','running','waiting_browser')),'oldest_pending',(SELECT min(created_at) FROM seo_jobs WHERE status IN ('queued','running','waiting_browser')),'last_success',(SELECT max(completed_at) FROM seo_jobs WHERE status='succeeded'),'failures_24h',(SELECT count(*) FROM seo_jobs WHERE status='failed' AND completed_at>now()-interval '24 hours')) FROM seo_worker_health h")
            .fetch_all(&state.db)
            .await;
    match result {
        Ok(rows) => Json(json!(rows)).into_response(),
        Err(e) => db_error(e).into_response(),
    }
}

// Narrow machine endpoint: only the trusted browser worker may inspect pending jobs.
pub async fn browser_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    use sha2::{Digest, Sha256};
    let expected = std::env::var("SEO_BROWSER_TOKEN")
        .ok()
        .filter(|s| s.len() >= 32)
        .ok_or_else(|| {
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "Browser worker is not configured".into(),
            )
        })?;
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .unwrap_or("");
    let a = Sha256::digest(expected.as_bytes());
    let b = Sha256::digest(supplied.as_bytes());
    if a.iter()
        .zip(b.iter())
        .fold(0u8, |diff, (x, y)| diff | (x ^ y))
        != 0
    {
        return Err((StatusCode::UNAUTHORIZED, "Unauthorized".into()));
    }
    let row=sqlx::query("SELECT j.status,j.created_at,s.config->'modules'->j.module->>'enabled' AS enabled,u.is_admin FROM seo_jobs j JOIN seo_sites s ON s.id=j.site_id JOIN users u ON u.id=s.user_id WHERE j.id=$1").bind(id).fetch_optional(&state.db).await.map_err(db_error)?.ok_or_else(||(StatusCode::NOT_FOUND,"Job not found".into()))?;
    let created: chrono::DateTime<chrono::Utc> = row.get("created_at");
    Ok(Json(
        json!({"active":row.get::<String,_>("status")=="waiting_browser" && row.get::<Option<String>,_>("enabled").as_deref()==Some("true") && row.get::<bool,_>("is_admin") && created>chrono::Utc::now()-chrono::Duration::hours(24)}),
    ))
}

pub async fn get_job(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult {
    let session = admin(&state, &headers).await?;
    let row: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(j)-'config' FROM seo_jobs j JOIN seo_sites s ON s.id=j.site_id WHERE j.id=$1 AND s.user_id=$2")
        .bind(id).bind(session.user.id).fetch_optional(&state.db).await.map_err(db_error)?;
    row.map(Json)
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Job not found".into()))
}
