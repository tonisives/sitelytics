use aes_gcm::{Aes256Gcm, KeyInit};
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub http: reqwest::Client,
    pub cipher: Aes256Gcm,
    pub app_url: String,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub admin_emails: Vec<String>,
    pub aeo_public_enabled: bool,
}

impl AppState {
    pub async fn from_env() -> Result<Self, String> {
        let database_url = required_env("DATABASE_URL")?;
        let encryption_key = decode_key(&required_env("APP_ENCRYPTION_KEY")?)?;
        let db = PgPool::connect(&database_url)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::migrate!()
            .run(&db)
            .await
            .map_err(|error| error.to_string())?;

        Ok(Self {
            db,
            http: reqwest::Client::new(),
            cipher: Aes256Gcm::new_from_slice(&encryption_key)
                .map_err(|error| error.to_string())?,
            app_url: std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:19000".into()),
            google_client_id: required_env("GOOGLE_CLIENT_ID")?,
            google_client_secret: required_env("GOOGLE_CLIENT_SECRET")?,
            admin_emails: std::env::var("ADMIN_EMAILS")
                .unwrap_or_default()
                .split(',')
                .map(|value| value.trim().to_lowercase())
                .filter(|value| !value.is_empty())
                .collect(),
            aeo_public_enabled: env_bool("AEO_PUBLIC_ENABLED"),
        })
    }
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("{name} must be configured"))
}

fn decode_key(value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(value)
        .or_else(|_| hex::decode(value))
        .map_err(|_| "APP_ENCRYPTION_KEY must be base64 or hex".to_string())?;
    if decoded.len() != 32 {
        return Err("APP_ENCRYPTION_KEY must decode to 32 bytes".into());
    }
    Ok(decoded)
}

fn env_bool(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| matches!(value.as_str(), "1" | "true" | "yes"))
}
