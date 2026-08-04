use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{identity, state::AppState};

#[derive(Serialize)]
pub struct AeoProperty {
    id: Uuid,
    site_url: String,
    brand_name: String,
    owned_domain: String,
    aliases: Vec<String>,
}

#[derive(Deserialize)]
pub struct PropertyInput {
    site_url: String,
    brand_name: String,
    owned_domain: String,
    #[serde(default)]
    aliases: Vec<String>,
}

#[derive(Serialize)]
pub struct AeoQuery {
    id: Uuid,
    property_id: Uuid,
    prompt: String,
    kind: String,
    cadence: String,
    active: bool,
    next_run_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct QueryInput {
    site_url: String,
    prompt: String,
    cadence: String,
    kind: Option<String>,
}

#[derive(Deserialize)]
pub struct QueryPatch {
    prompt: Option<String>,
    cadence: Option<String>,
    kind: Option<String>,
    active: Option<bool>,
}

#[derive(Deserialize)]
pub struct SiteQuery {
    site_url: String,
}

#[derive(Deserialize)]
pub struct DashboardInput {
    site_urls: Vec<String>,
}

pub async fn get_property(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SiteQuery>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let row = sqlx::query("SELECT id,site_url,brand_name,owned_domain,aliases FROM aeo_properties WHERE user_id=$1 AND site_url=$2")
        .bind(session.user.id).bind(query.site_url).fetch_optional(&state.db).await;
    match row {
        Ok(Some(row)) => Json(property_from_row(&row)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal(error),
    }
}

pub async fn put_property(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<PropertyInput>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !state.aeo_public_enabled && !session.user.is_admin {
        return feature_disabled();
    }
    if input.brand_name.trim().is_empty()
        || input.owned_domain.trim().is_empty()
        || input.site_url.trim().is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            "site_url, brand_name and owned_domain are required",
        )
            .into_response();
    }
    let owns_property = crate::api::server::fetch_dashboard(&session.access_token, 1)
        .await
        .is_ok_and(|dashboard| {
            dashboard
                .properties
                .iter()
                .any(|property| property.site_url == input.site_url)
        });
    if !owns_property {
        return (
            StatusCode::FORBIDDEN,
            "the Google account does not have access to this Search Console property",
        )
            .into_response();
    }
    let aliases = normalized_aliases(&input.brand_name, input.aliases);
    let row = sqlx::query(
        "INSERT INTO aeo_properties (user_id,site_url,brand_name,owned_domain,aliases) VALUES ($1,$2,$3,$4,$5) \
         ON CONFLICT (user_id,site_url) DO UPDATE SET brand_name=EXCLUDED.brand_name,owned_domain=EXCLUDED.owned_domain,aliases=EXCLUDED.aliases,updated_at=now() \
         RETURNING id,site_url,brand_name,owned_domain,aliases"
    ).bind(session.user.id).bind(input.site_url.trim()).bind(input.brand_name.trim()).bind(normalize_domain(&input.owned_domain)).bind(aliases)
        .fetch_one(&state.db).await;
    match row {
        Ok(row) => Json(property_from_row(&row)).into_response(),
        Err(error) => internal(error),
    }
}

pub async fn list_queries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SiteQuery>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let rows = sqlx::query(
        "SELECT q.id,q.property_id,q.prompt,q.kind::text AS kind,q.cadence::text AS cadence,q.active,q.next_run_at \
         FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id WHERE p.user_id=$1 AND p.site_url=$2 ORDER BY q.created_at"
    ).bind(session.user.id).bind(query.site_url).fetch_all(&state.db).await;
    match rows {
        Ok(rows) => Json(rows.iter().map(query_from_row).collect::<Vec<_>>()).into_response(),
        Err(error) => internal(error),
    }
}

pub async fn create_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<QueryInput>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !state.aeo_public_enabled && !session.user.is_admin {
        return feature_disabled();
    }
    if !matches!(input.cadence.as_str(), "weekly" | "monthly") || input.prompt.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            "prompt and a weekly or monthly cadence are required",
        )
            .into_response();
    }
    let property =
        sqlx::query("SELECT id,aliases FROM aeo_properties WHERE user_id=$1 AND site_url=$2")
            .bind(session.user.id)
            .bind(&input.site_url)
            .fetch_optional(&state.db)
            .await;
    let Ok(Some(property)) = property else {
        return (StatusCode::BAD_REQUEST, "configure the property first").into_response();
    };
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id WHERE p.user_id=$1 AND q.active")
        .bind(session.user.id).fetch_one(&state.db).await.unwrap_or(10);
    if count >= 10 {
        return (
            StatusCode::CONFLICT,
            "free beta allows 10 active queries per account",
        )
            .into_response();
    }
    let aliases: Vec<String> = property.try_get("aliases").unwrap_or_default();
    let suggested = if aliases
        .iter()
        .any(|alias| contains_alias(&input.prompt, alias))
    {
        "branded"
    } else {
        "discovery"
    };
    let kind = input.kind.as_deref().unwrap_or(suggested);
    if !matches!(kind, "discovery" | "branded") {
        return (StatusCode::BAD_REQUEST, "kind must be discovery or branded").into_response();
    }
    let property_id: Uuid = match property.try_get("id") {
        Ok(value) => value,
        Err(error) => return internal(error),
    };
    let row = sqlx::query(
        "INSERT INTO aeo_queries (property_id,prompt,kind,cadence,next_run_at) VALUES ($1,$2,$3::aeo_query_kind,$4::aeo_cadence,now()) \
         RETURNING id,property_id,prompt,kind::text AS kind,cadence::text AS cadence,active,next_run_at"
    ).bind(property_id).bind(input.prompt.trim()).bind(kind).bind(&input.cadence).fetch_one(&state.db).await;
    match row {
        Ok(row) => Json(query_from_row(&row)).into_response(),
        Err(error) => internal(error),
    }
}

pub async fn patch_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<QueryPatch>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let cadence = input.cadence.as_deref().unwrap_or("weekly");
    let kind = input.kind.as_deref().unwrap_or("discovery");
    if input.cadence.is_some() && !matches!(cadence, "weekly" | "monthly")
        || input.kind.is_some() && !matches!(kind, "discovery" | "branded")
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    if input.active == Some(true) {
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id WHERE p.user_id=$1 AND q.active")
            .bind(session.user.id).fetch_one(&state.db).await.unwrap_or(10);
        if count >= 10 {
            return (
                StatusCode::CONFLICT,
                "free beta allows 10 active queries per account",
            )
                .into_response();
        }
    }
    let row = sqlx::query(
        "UPDATE aeo_queries q SET prompt=COALESCE($3,prompt),cadence=COALESCE($4::aeo_cadence,cadence),kind=COALESCE($5::aeo_query_kind,kind),active=COALESCE($6,active),updated_at=now() \
         FROM aeo_properties p WHERE q.id=$1 AND q.property_id=p.id AND p.user_id=$2 \
         RETURNING q.id,q.property_id,q.prompt,q.kind::text AS kind,q.cadence::text AS cadence,q.active,q.next_run_at"
    ).bind(id).bind(session.user.id).bind(input.prompt).bind(input.cadence).bind(input.kind).bind(input.active).fetch_optional(&state.db).await;
    match row {
        Ok(Some(row)) => Json(query_from_row(&row)).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal(error),
    }
}

pub async fn delete_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let result = sqlx::query("UPDATE aeo_queries q SET active=false,updated_at=now() FROM aeo_properties p WHERE q.id=$1 AND q.property_id=p.id AND p.user_id=$2")
        .bind(id).bind(session.user.id).execute(&state.db).await;
    match result {
        Ok(value) if value.rows_affected() == 1 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => StatusCode::NOT_FOUND.into_response(),
        Err(error) => internal(error),
    }
}

pub async fn dashboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<DashboardInput>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let rows = sqlx::query(
        "WITH latest_runs AS (SELECT DISTINCT ON (r.query_id) r.id,r.query_id,p.site_url FROM aeo_runs r JOIN aeo_queries q ON q.id=r.query_id JOIN aeo_properties p ON p.id=q.property_id WHERE p.user_id=$1 AND q.kind='discovery' AND p.site_url=ANY($2) ORDER BY r.query_id,r.scheduled_for DESC), \
        agg AS (SELECT lr.site_url,lr.query_id,s.provider::text AS provider,count(*) FILTER (WHERE s.status='succeeded') AS successful,percentile_disc(0.5) WITHIN GROUP (ORDER BY CASE s.level WHEN 'absent' THEN 0 WHEN 'cited' THEN 1 WHEN 'mentioned' THEN 2 WHEN 'recommended' THEN 3 WHEN 'top_pick' THEN 4 END) FILTER (WHERE s.status='succeeded') AS median_level FROM latest_runs lr JOIN aeo_samples s ON s.run_id=lr.id GROUP BY lr.site_url,lr.query_id,s.provider) \
        SELECT site_url,count(*) FILTER (WHERE successful>=2) AS known_pairs,count(*) FILTER (WHERE successful<2) AS unknown_pairs,count(*) FILTER (WHERE successful>=2 AND median_level>=2) AS mentioned_pairs,count(*) FILTER (WHERE successful>=2 AND median_level>=3) AS recommended_pairs FROM agg GROUP BY site_url"
    ).bind(session.user.id).bind(&input.site_urls).fetch_all(&state.db).await;
    match rows {
        Ok(rows) => Json(rows.iter().map(|row| serde_json::json!({
            "site_url": row.try_get::<String,_>("site_url").unwrap_or_default(),
            "known": row.try_get::<i64,_>("known_pairs").unwrap_or_default(),
            "unknown": row.try_get::<i64,_>("unknown_pairs").unwrap_or_default(),
            "mentioned": row.try_get::<i64,_>("mentioned_pairs").unwrap_or_default(),
            "recommended": row.try_get::<i64,_>("recommended_pairs").unwrap_or_default(),
        })).collect::<Vec<_>>()).into_response(),
        Err(error) => internal(error),
    }
}

pub async fn results(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SiteQuery>,
) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let rows = sqlx::query(
        "SELECT q.id AS query_id,q.prompt,q.kind::text AS kind,q.cadence::text AS cadence,r.id AS run_id,r.scheduled_for,s.provider::text AS provider,s.sample_number,s.status::text AS status,s.level::text AS level,s.rank,s.owned_domain_cited,s.evidence,s.citations,s.competitors,s.error_code,s.latency_ms \
         FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id LEFT JOIN aeo_runs r ON r.query_id=q.id LEFT JOIN aeo_samples s ON s.run_id=r.id \
         WHERE p.user_id=$1 AND p.site_url=$2 ORDER BY q.created_at,r.scheduled_for DESC,s.provider,s.sample_number"
    ).bind(session.user.id).bind(query.site_url).fetch_all(&state.db).await;
    match rows {
        Ok(rows) => Json(rows.iter().map(result_json).collect::<Vec<_>>()).into_response(),
        Err(error) => internal(error),
    }
}

pub async fn admin_usage(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Ok(session) = identity::session(&state, &headers).await else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    if !session.user.is_admin {
        return StatusCode::FORBIDDEN.into_response();
    }
    let row = sqlx::query(
        "SELECT (SELECT count(*) FROM users) AS users,(SELECT count(*) FROM users WHERE created_at>now()-interval '7 days') AS signups_7d, \
         (SELECT count(DISTINCT p.user_id) FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id WHERE q.active) AS active_aeo_users, \
         (SELECT count(*) FROM aeo_queries WHERE active) AS active_queries,(SELECT count(*) FROM aeo_queries WHERE active AND next_run_at<=now()) AS backlog, \
         (SELECT count(*) FROM aeo_samples WHERE created_at>now()-interval '7 days') AS samples_7d, \
         (SELECT count(*) FROM aeo_samples WHERE created_at>now()-interval '7 days' AND status='succeeded') AS success_7d, \
         (SELECT count(*) FROM aeo_samples WHERE created_at>now()-interval '7 days' AND status='blocked') AS blocked_7d"
    ).fetch_one(&state.db).await;
    let health = sqlx::query("SELECT provider::text AS provider,circuit_open_until,last_success_at,last_error_code,consecutive_failures FROM aeo_provider_health ORDER BY provider")
        .fetch_all(&state.db).await.unwrap_or_default();
    let active_sessions: i64 =
        sqlx::query_scalar("SELECT count(*) FROM user_sessions WHERE expires_at>now()")
            .fetch_one(&state.db)
            .await
            .unwrap_or_default();
    let average_latency_ms: Option<f64> = sqlx::query_scalar("SELECT avg(latency_ms)::float8 FROM aeo_samples WHERE created_at>now()-interval '7 days' AND latency_ms IS NOT NULL")
        .fetch_one(&state.db).await.unwrap_or_default();
    let recent_failures = sqlx::query("SELECT s.provider::text AS provider,s.error_code,s.completed_at,q.prompt FROM aeo_samples s JOIN aeo_runs r ON r.id=s.run_id JOIN aeo_queries q ON q.id=r.query_id WHERE s.status IN ('failed','blocked') ORDER BY s.completed_at DESC LIMIT 20")
        .fetch_all(&state.db).await.unwrap_or_default();
    match row { Ok(row) => Json(serde_json::json!({
        "users": row.try_get::<i64,_>("users").unwrap_or_default(), "signups_7d": row.try_get::<i64,_>("signups_7d").unwrap_or_default(),
        "active_aeo_users": row.try_get::<i64,_>("active_aeo_users").unwrap_or_default(), "active_queries": row.try_get::<i64,_>("active_queries").unwrap_or_default(),
        "backlog": row.try_get::<i64,_>("backlog").unwrap_or_default(), "samples_7d": row.try_get::<i64,_>("samples_7d").unwrap_or_default(),
        "success_7d": row.try_get::<i64,_>("success_7d").unwrap_or_default(), "blocked_7d": row.try_get::<i64,_>("blocked_7d").unwrap_or_default(), "active_sessions":active_sessions,"average_latency_ms":average_latency_ms,
        "providers": health.iter().map(|h| serde_json::json!({"provider":h.try_get::<String,_>("provider").unwrap_or_default(),"circuit_open_until":h.try_get::<Option<DateTime<Utc>>,_>("circuit_open_until").unwrap_or_default(),"last_success_at":h.try_get::<Option<DateTime<Utc>>,_>("last_success_at").unwrap_or_default(),"last_error_code":h.try_get::<Option<String>,_>("last_error_code").unwrap_or_default(),"consecutive_failures":h.try_get::<i32,_>("consecutive_failures").unwrap_or_default()})).collect::<Vec<_>>(),
        "recent_failures":recent_failures.iter().map(|failure|serde_json::json!({"provider":failure.try_get::<String,_>("provider").unwrap_or_default(),"error_code":failure.try_get::<Option<String>,_>("error_code").unwrap_or_default(),"completed_at":failure.try_get::<Option<DateTime<Utc>>,_>("completed_at").unwrap_or_default(),"prompt":failure.try_get::<String,_>("prompt").unwrap_or_default()})).collect::<Vec<_>>()
    })).into_response(), Err(error) => internal(error) }
}

fn property_from_row(row: &sqlx::postgres::PgRow) -> AeoProperty {
    AeoProperty {
        id: row.get("id"),
        site_url: row.get("site_url"),
        brand_name: row.get("brand_name"),
        owned_domain: row.get("owned_domain"),
        aliases: row.get("aliases"),
    }
}
fn query_from_row(row: &sqlx::postgres::PgRow) -> AeoQuery {
    AeoQuery {
        id: row.get("id"),
        property_id: row.get("property_id"),
        prompt: row.get("prompt"),
        kind: row.get("kind"),
        cadence: row.get("cadence"),
        active: row.get("active"),
        next_run_at: row.get("next_run_at"),
    }
}
fn result_json(row: &sqlx::postgres::PgRow) -> serde_json::Value {
    serde_json::json!({"query_id":row.try_get::<Uuid,_>("query_id").ok(),"prompt":row.try_get::<String,_>("prompt").ok(),"kind":row.try_get::<String,_>("kind").ok(),"cadence":row.try_get::<String,_>("cadence").ok(),"run_id":row.try_get::<Uuid,_>("run_id").ok(),"scheduled_for":row.try_get::<DateTime<Utc>,_>("scheduled_for").ok(),"provider":row.try_get::<String,_>("provider").ok(),"sample_number":row.try_get::<i16,_>("sample_number").ok(),"status":row.try_get::<String,_>("status").ok(),"level":row.try_get::<String,_>("level").ok(),"rank":row.try_get::<i32,_>("rank").ok(),"owned_domain_cited":row.try_get::<bool,_>("owned_domain_cited").ok(),"evidence":row.try_get::<String,_>("evidence").ok(),"citations":row.try_get::<serde_json::Value,_>("citations").unwrap_or_else(|_|serde_json::json!([])),"competitors":row.try_get::<serde_json::Value,_>("competitors").unwrap_or_else(|_|serde_json::json!([])),"error_code":row.try_get::<String,_>("error_code").ok(),"latency_ms":row.try_get::<i32,_>("latency_ms").ok()})
}
fn normalized_aliases(brand: &str, aliases: Vec<String>) -> Vec<String> {
    let mut values = vec![brand.trim().to_string()];
    values.extend(
        aliases
            .into_iter()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
    );
    values.sort_by_key(|v| v.to_lowercase());
    values.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    values
}
fn contains_alias(prompt: &str, alias: &str) -> bool {
    let prompt = prompt.nfkc().collect::<String>().to_lowercase();
    let alias = alias.nfkc().collect::<String>().to_lowercase();
    prompt.contains(&alias)
}
fn normalize_domain(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_lowercase()
}
fn feature_disabled() -> Response {
    (StatusCode::NOT_FOUND, "AEO beta is not enabled").into_response()
}
fn internal(error: impl std::fmt::Display) -> Response {
    tracing::error!(%error, "AEO database request failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}
