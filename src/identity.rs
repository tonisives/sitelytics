use aes_gcm::{AeadCore, Aes256Gcm, aead::Aead};
use axum::{
    Json,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{AppendHeaders, IntoResponse, Redirect, Response},
};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

const COOKIE_NAME: &str = "sitelytics_session";

#[derive(Clone, Debug, Serialize)]
pub struct CurrentUser {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_admin: bool,
}

pub struct SessionData {
    pub user: CurrentUser,
    pub access_token: String,
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: Option<String>,
    error: Option<String>,
    state: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Deserialize)]
struct GoogleClaims {
    sub: String,
    email: String,
    name: Option<String>,
    picture: Option<String>,
    email_verified: Option<bool>,
}

pub async fn auth_google(State(state): State<AppState>) -> Response {
    let redirect_uri = format!("{}/auth/callback", state.app_url);
    let oauth_state = random_token();
    let scope = "openid email profile https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=offline&prompt=consent&include_granted_scopes=true",
        urlencoding::encode(&state.google_client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(scope),
        urlencoding::encode(&oauth_state),
    );
    let secure_attribute = if state.app_url.starts_with("https://") {
        "; Secure"
    } else {
        ""
    };
    let cookie = format!(
        "sitelytics_oauth_state={oauth_state}; Path=/auth; HttpOnly{secure_attribute}; SameSite=Lax; Max-Age=600"
    );
    (
        [(http::header::SET_COOKIE, cookie)],
        Redirect::temporary(&url),
    )
        .into_response()
}

pub async fn auth_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<CallbackParams>,
) -> Response {
    if params.error.is_some() {
        return Redirect::temporary("/login?error=oauth_denied").into_response();
    }
    let Some(code) = params.code else {
        return Redirect::temporary("/login?error=missing_code").into_response();
    };
    let oauth_state = cookie_value(&headers, "sitelytics_oauth_state");
    if oauth_state.as_deref() != params.state.as_deref() || oauth_state.is_none() {
        return Redirect::temporary("/login?error=oauth_state").into_response();
    }
    match finish_login(&state, &code).await {
        Ok(cookie) => (
            AppendHeaders([
                (http::header::SET_COOKIE, cookie),
                (
                    http::header::SET_COOKIE,
                    "sitelytics_oauth_state=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0"
                        .to_string(),
                ),
            ]),
            Redirect::temporary("/"),
        )
            .into_response(),
        Err(error) => {
            tracing::error!(%error, "Google sign-in failed");
            Redirect::temporary("/login?error=oauth_failed").into_response()
        }
    }
}

async fn finish_login(state: &AppState, code: &str) -> Result<String, String> {
    let redirect_uri = format!("{}/auth/callback", state.app_url);
    let response = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", state.google_client_id.as_str()),
            ("client_secret", state.google_client_secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("token endpoint returned {status}"));
    }
    let tokens: TokenResponse = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let claims: GoogleClaims = state
        .http
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json()
        .await
        .map_err(|error| error.to_string())?;
    let email = claims.email.to_lowercase();
    if claims.email_verified != Some(true) {
        return Err("Google account email is not verified".into());
    }
    let is_admin = state.admin_emails.contains(&email);
    let mut transaction = state.db.begin().await.map_err(|error| error.to_string())?;
    let user_row = sqlx::query(
        "INSERT INTO users (google_sub, email, display_name, avatar_url, is_admin) VALUES ($1,$2,$3,$4,$5) \
         ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url, is_admin=EXCLUDED.is_admin, last_seen_at=now() \
         RETURNING id"
    ).bind(&claims.sub).bind(&email).bind(&claims.name).bind(&claims.picture).bind(is_admin)
        .fetch_one(&mut *transaction).await.map_err(|error| error.to_string())?;
    let user_id: Uuid = user_row.try_get("id").map_err(|error| error.to_string())?;
    let refresh = tokens.refresh_token.ok_or_else(|| {
        "Google did not return a refresh token; revoke app access and sign in again".to_string()
    })?;
    let (encrypted, nonce) = encrypt(&state.cipher, refresh.as_bytes())?;
    sqlx::query(
        "INSERT INTO oauth_credentials (user_id, encrypted_refresh_token, nonce, access_token, access_token_expires_at) VALUES ($1,$2,$3,$4,$5) \
         ON CONFLICT (user_id) DO UPDATE SET encrypted_refresh_token=EXCLUDED.encrypted_refresh_token, nonce=EXCLUDED.nonce, access_token=EXCLUDED.access_token, access_token_expires_at=EXCLUDED.access_token_expires_at, updated_at=now()"
    ).bind(user_id).bind(encrypted).bind(nonce).bind(&tokens.access_token).bind(Utc::now() + Duration::seconds(tokens.expires_in))
        .execute(&mut *transaction).await.map_err(|error| error.to_string())?;
    let raw_token = random_token();
    sqlx::query("INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)")
        .bind(user_id)
        .bind(hash_token(&raw_token))
        .bind(Utc::now() + Duration::days(30))
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    notify_new_user(state, &email, user_id).await;
    Ok(session_cookie(
        &raw_token,
        state.app_url.starts_with("https://"),
    ))
}

pub async fn session(state: &AppState, headers: &HeaderMap) -> Result<SessionData, StatusCode> {
    let token = cookie_value(headers, COOKIE_NAME).ok_or(StatusCode::UNAUTHORIZED)?;
    let row = sqlx::query(
        "SELECT u.id,u.email,u.display_name,u.avatar_url,u.is_admin,c.access_token,c.access_token_expires_at,c.encrypted_refresh_token,c.nonce \
         FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN oauth_credentials c ON c.user_id=u.id \
         WHERE s.token_hash=$1 AND s.expires_at > now()"
    ).bind(hash_token(&token)).fetch_optional(&state.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let user = CurrentUser {
        id: row
            .try_get("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        email: row
            .try_get("email")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        display_name: row
            .try_get("display_name")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        avatar_url: row
            .try_get("avatar_url")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
        is_admin: row
            .try_get("is_admin")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    };
    let expires_at: DateTime<Utc> = row
        .try_get("access_token_expires_at")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let access_token: String = row
        .try_get("access_token")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if expires_at > Utc::now() + Duration::minutes(1) {
        return Ok(SessionData { user, access_token });
    }
    let encrypted: Vec<u8> = row
        .try_get("encrypted_refresh_token")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let nonce: Vec<u8> = row
        .try_get("nonce")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let refresh =
        decrypt(&state.cipher, &encrypted, &nonce).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let refreshed: RefreshResponse = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("refresh_token", refresh.as_str()),
            ("client_id", state.google_client_id.as_str()),
            ("client_secret", state.google_client_secret.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?
        .json()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    sqlx::query("UPDATE oauth_credentials SET access_token=$2,access_token_expires_at=$3,updated_at=now() WHERE user_id=$1")
        .bind(user.id).bind(&refreshed.access_token).bind(Utc::now() + Duration::seconds(refreshed.expires_in))
        .execute(&state.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(SessionData {
        user,
        access_token: refreshed.access_token,
    })
}

pub async fn me(State(state): State<AppState>, headers: HeaderMap) -> Response {
    match session(&state, &headers).await {
        Ok(value) => Json(value.user).into_response(),
        Err(status) => status.into_response(),
    }
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie_value(&headers, COOKIE_NAME) {
        let _ = sqlx::query("DELETE FROM user_sessions WHERE token_hash=$1")
            .bind(hash_token(&token))
            .execute(&state.db)
            .await;
    }
    let secure_attribute = if state.app_url.starts_with("https://") {
        "; Secure"
    } else {
        ""
    };
    (
        [(
            http::header::SET_COOKIE,
            format!("{COOKIE_NAME}=; Path=/; HttpOnly{secure_attribute}; SameSite=Lax; Max-Age=0"),
        )],
        Json(serde_json::json!({"ok": true})),
    )
        .into_response()
}

fn random_token() -> String {
    use base64::Engine;
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn hash_token(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn session_cookie(token: &str, secure: bool) -> String {
    let secure_attribute = if secure { "; Secure" } else { "" };
    format!(
        "{COOKIE_NAME}={token}; Path=/; HttpOnly{secure_attribute}; SameSite=Lax; Max-Age=2592000"
    )
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(http::header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .map(str::trim)
        .find_map(|part| part.strip_prefix(&format!("{name}=")).map(str::to_string))
}

fn encrypt(cipher: &Aes256Gcm, value: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let nonce = Aes256Gcm::generate_nonce(&mut aes_gcm::aead::OsRng);
    let encrypted = cipher
        .encrypt(&nonce, value)
        .map_err(|error| error.to_string())?;
    Ok((encrypted, nonce.to_vec()))
}

fn decrypt(cipher: &Aes256Gcm, value: &[u8], nonce: &[u8]) -> Result<String, String> {
    let nonce = aes_gcm::Nonce::from_slice(nonce);
    let decrypted = cipher
        .decrypt(nonce, value)
        .map_err(|error| error.to_string())?;
    String::from_utf8(decrypted).map_err(|error| error.to_string())
}

async fn notify_new_user(state: &AppState, email: &str, user_id: Uuid) {
    let dedupe = format!("new-user:{user_id}");
    let inserted = sqlx::query(
        "INSERT INTO notification_events (dedupe_key) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(&dedupe)
    .execute(&state.db)
    .await
    .is_ok_and(|result| result.rows_affected() == 1);
    if !inserted {
        return;
    }
    let Ok(endpoint) = std::env::var("TELEGRAM_ALERT_URL") else {
        return;
    };
    let _ = state
        .http
        .post(endpoint)
        .json(&serde_json::json!({"text": format!("Sitelytics signup: {email}")}))
        .send()
        .await;
}
