use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GscMetrics {
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyRow {
    pub date: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
    #[serde(default)]
    pub ga_sessions: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyData {
    pub site_url: String,
    pub permission_level: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
    pub daily: Vec<DailyRow>,
    #[serde(default)]
    pub ga_sessions: Option<f64>,
    #[serde(default)]
    pub ga_property_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardData {
    pub properties: Vec<PropertyData>,
    pub totals: GscMetrics,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DimensionRow {
    pub key: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
}

pub mod server {
    use super::*;
    use axum::extract::Query;
    use axum::response::{IntoResponse, Redirect, Response};

    fn http_client() -> &'static reqwest::Client {
        static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
            reqwest::Client::builder()
                .pool_max_idle_per_host(5)
                .build()
                .unwrap_or_default()
        });
        &CLIENT
    }

    fn google_client_id() -> String {
        std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default()
    }

    fn google_client_secret() -> String {
        std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default()
    }

    fn app_url() -> String {
        std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:19000".into())
    }

    pub async fn auth_google() -> Redirect {
        let client_id = google_client_id();
        let redirect_uri = format!("{}/auth/callback", app_url());
        let scope = "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly";
        let url = format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
            client_id,
            urlencoding::encode(&redirect_uri),
            urlencoding::encode(scope),
        );
        Redirect::temporary(&url)
    }

    #[derive(Deserialize)]
    pub struct CallbackParams {
        pub code: Option<String>,
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

    pub async fn auth_callback(Query(params): Query<CallbackParams>) -> Response {
        let Some(code) = params.code else {
            return Redirect::temporary("/login").into_response();
        };

        let client = http_client();
        let Ok(token_res) = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("code", code.as_str()),
                ("client_id", &google_client_id()),
                ("client_secret", &google_client_secret()),
                ("redirect_uri", &format!("{}/auth/callback", app_url())),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
        else {
            return Redirect::temporary("/login").into_response();
        };

        let Ok(tokens) = token_res.json::<TokenResponse>().await else {
            return Redirect::temporary("/login").into_response();
        };

        let session_data = serde_json::json!({
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token.unwrap_or_default(),
            "expires_at": now_secs() + tokens.expires_in,
        });

        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            session_data.to_string().as_bytes(),
        );

        let cookie_str = format!(
            "gsc_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
            encoded
        );

        (
            [(http::header::SET_COOKIE, cookie_str)],
            Redirect::temporary("/"),
        )
            .into_response()
    }

    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs())
    }

    #[derive(Deserialize)]
    struct RawSession {
        access_token: String,
        refresh_token: String,
        expires_at: u64,
    }

    pub struct SessionData {
        pub access_token: String,
        pub updated_cookie: Option<String>,
    }

    fn parse_session_cookie(headers: &http::HeaderMap) -> Option<RawSession> {
        let cookies = headers.get_all(http::header::COOKIE);
        for val in cookies {
            let Ok(s) = val.to_str() else { continue };
            for part in s.split(';') {
                let part = part.trim();
                if let Some(value) = part.strip_prefix("gsc_session=") {
                    let Ok(decoded) = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        value.trim(),
                    ) else {
                        continue;
                    };
                    let Ok(data) = serde_json::from_slice::<RawSession>(&decoded) else {
                        continue;
                    };
                    return Some(data);
                }
            }
        }
        None
    }

    async fn refresh_access_token(refresh_token: &str) -> Option<(String, u64)> {
        let client = http_client();
        let res = client
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("refresh_token", refresh_token),
                ("client_id", &google_client_id()),
                ("client_secret", &google_client_secret()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .ok()?;

        #[derive(Deserialize)]
        struct RefreshResponse {
            access_token: String,
            expires_in: u64,
        }

        let tokens: RefreshResponse = res.json().await.ok()?;
        Some((tokens.access_token, tokens.expires_in))
    }

    fn build_session_cookie(access_token: &str, refresh_token: &str, expires_at: u64) -> String {
        let session_data = serde_json::json!({
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
        });
        let encoded = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            session_data.to_string().as_bytes(),
        );
        format!(
            "gsc_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
            encoded
        )
    }

    pub async fn extract_session(headers: &http::HeaderMap) -> Option<SessionData> {
        let raw = parse_session_cookie(headers)?;

        if now_secs() + 60 < raw.expires_at {
            return Some(SessionData {
                access_token: raw.access_token,
                updated_cookie: None,
            });
        }

        if raw.refresh_token.is_empty() {
            eprintln!("[auth] token expired, no refresh token");
            return None;
        }

        eprintln!("[auth] token expired, refreshing...");
        let (new_token, expires_in) = refresh_access_token(&raw.refresh_token).await?;
        let new_expires_at = now_secs() + expires_in;
        let cookie = build_session_cookie(&new_token, &raw.refresh_token, new_expires_at);
        eprintln!("[auth] token refreshed successfully");

        Some(SessionData {
            access_token: new_token,
            updated_cookie: Some(cookie),
        })
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GscSitesResponse {
        #[serde(default)]
        site_entry: Vec<GscSiteEntry>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GscSiteEntry {
        site_url: String,
        permission_level: String,
    }

    #[derive(Deserialize)]
    struct GscAnalyticsResponse {
        #[serde(default)]
        rows: Vec<GscAnalyticsRow>,
    }

    #[derive(Deserialize)]
    struct GscAnalyticsRow {
        #[serde(default)]
        keys: Vec<String>,
        #[serde(default)]
        clicks: f64,
        #[serde(default)]
        impressions: f64,
        #[serde(default)]
        position: f64,
    }

    fn date_range(days: u64) -> (String, String) {
        let now = now_secs();
        let day_secs = 86400;
        let end = now - (3 * day_secs);
        let start = end - (days * day_secs);

        let fmt = |ts: u64| -> String {
            let days_since_epoch = ts / day_secs;
            let mut y = 1970i64;
            let mut remaining = days_since_epoch as i64;
            loop {
                let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
                let days_in_year = if leap { 366 } else { 365 };
                if remaining < days_in_year {
                    break;
                }
                remaining -= days_in_year;
                y += 1;
            }
            let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
            let days_in_months: [i64; 12] = [
                31,
                if leap { 29 } else { 28 },
                31,
                30,
                31,
                30,
                31,
                31,
                30,
                31,
                30,
                31,
            ];
            let mut m = 0;
            for &dim in &days_in_months {
                if remaining < dim {
                    break;
                }
                remaining -= dim;
                m += 1;
            }
            format!("{y}-{:02}-{:02}", m + 1, remaining + 1)
        };

        (fmt(start), fmt(end))
    }

    pub async fn fetch_dashboard(access_token: &str, days: u64) -> Result<DashboardData, String> {
        let client = http_client();

        let sites_res = client
            .get("https://www.googleapis.com/webmasters/v3/sites")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !sites_res.status().is_success() {
            let status = sites_res.status();
            let body = sites_res.text().await.unwrap_or_default();
            return Err(format!("GSC sites API error {status}: {body}"));
        }

        let sites: GscSitesResponse = sites_res.json().await.map_err(|e| e.to_string())?;
        let (start_date, end_date) = date_range(days);

        let mut properties = Vec::new();

        for site in &sites.site_entry {
            let body = serde_json::json!({
                "startDate": start_date,
                "endDate": end_date,
                "dimensions": ["date"],
                "rowLimit": 500,
            });

            let analytics_res = client
                .post(format!(
                    "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
                    urlencoding::encode(&site.site_url)
                ))
                .bearer_auth(access_token)
                .json(&body)
                .send()
                .await;

            let Ok(res) = analytics_res else { continue };
            if !res.status().is_success() {
                continue;
            }
            let Ok(data) = res.json::<GscAnalyticsResponse>().await else {
                continue;
            };

            let total_clicks: f64 = data.rows.iter().map(|r| r.clicks).sum();
            let total_impressions: f64 = data.rows.iter().map(|r| r.impressions).sum();
            let avg_ctr = if total_impressions > 0.0 {
                total_clicks / total_impressions
            } else {
                0.0
            };
            let avg_position = if data.rows.is_empty() {
                0.0
            } else {
                data.rows.iter().map(|r| r.position).sum::<f64>() / data.rows.len() as f64
            };

            let daily: Vec<DailyRow> = data
                .rows
                .iter()
                .map(|r| {
                    let ctr = if r.impressions > 0.0 {
                        r.clicks / r.impressions
                    } else {
                        0.0
                    };
                    DailyRow {
                        date: r.keys.first().cloned().unwrap_or_default(),
                        clicks: r.clicks,
                        impressions: r.impressions,
                        ctr,
                        position: r.position,
                        ga_sessions: None,
                    }
                })
                .collect();

            properties.push(PropertyData {
                site_url: site.site_url.clone(),
                permission_level: site.permission_level.clone(),
                clicks: total_clicks,
                impressions: total_impressions,
                ctr: avg_ctr,
                position: avg_position,
                daily,
                ga_sessions: None,
                ga_property_id: None,
            });
        }

        properties.sort_by(|a, b| {
            b.impressions
                .partial_cmp(&a.impressions)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let total_clicks: f64 = properties.iter().map(|p| p.clicks).sum();
        let total_impressions: f64 = properties.iter().map(|p| p.impressions).sum();
        let avg_ctr = if total_impressions > 0.0 {
            total_clicks / total_impressions
        } else {
            0.0
        };
        let avg_position = if properties.is_empty() {
            0.0
        } else {
            properties.iter().map(|p| p.position).sum::<f64>() / properties.len() as f64
        };

        Ok(DashboardData {
            properties,
            totals: GscMetrics {
                clicks: total_clicks,
                impressions: total_impressions,
                ctr: avg_ctr,
                position: avg_position,
            },
            fetched_at: format!("{}", now_secs()),
        })
    }

    pub async fn fetch_property(
        access_token: &str,
        site_url: &str,
        days: u64,
    ) -> Result<PropertyData, String> {
        let client = http_client();
        let (start_date, end_date) = date_range(days);

        let body = serde_json::json!({
            "startDate": start_date,
            "endDate": end_date,
            "dimensions": ["date"],
            "rowLimit": 500,
        });

        let res = client
            .post(format!(
                "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
                urlencoding::encode(site_url)
            ))
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("GSC API error {status}: {body}"));
        }

        let data: GscAnalyticsResponse = res.json().await.map_err(|e| e.to_string())?;

        let total_clicks: f64 = data.rows.iter().map(|r| r.clicks).sum();
        let total_impressions: f64 = data.rows.iter().map(|r| r.impressions).sum();
        let avg_ctr = if total_impressions > 0.0 {
            total_clicks / total_impressions
        } else {
            0.0
        };
        let avg_position = if data.rows.is_empty() {
            0.0
        } else {
            data.rows.iter().map(|r| r.position).sum::<f64>() / data.rows.len() as f64
        };

        let daily: Vec<DailyRow> = data
            .rows
            .iter()
            .map(|r| {
                let ctr = if r.impressions > 0.0 {
                    r.clicks / r.impressions
                } else {
                    0.0
                };
                DailyRow {
                    date: r.keys.first().cloned().unwrap_or_default(),
                    clicks: r.clicks,
                    impressions: r.impressions,
                    ctr,
                    position: r.position,
                    ga_sessions: None,
                }
            })
            .collect();

        Ok(PropertyData {
            site_url: site_url.to_string(),
            permission_level: String::new(),
            clicks: total_clicks,
            impressions: total_impressions,
            ctr: avg_ctr,
            position: avg_position,
            daily,
            ga_sessions: None,
            ga_property_id: None,
        })
    }

    pub async fn fetch_dimension(
        access_token: &str,
        site_url: &str,
        dimension: &str,
        days: u64,
    ) -> Result<Vec<DimensionRow>, String> {
        let client = http_client();
        let (start_date, end_date) = date_range(days);

        let body = serde_json::json!({
            "startDate": start_date,
            "endDate": end_date,
            "dimensions": [dimension],
            "rowLimit": 25,
        });

        let res = client
            .post(format!(
                "https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",
                urlencoding::encode(site_url)
            ))
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("GSC API error {status}: {body}"));
        }

        let data: GscAnalyticsResponse = res.json().await.map_err(|e| e.to_string())?;

        let rows = data
            .rows
            .into_iter()
            .map(|r| {
                let ctr = if r.impressions > 0.0 {
                    r.clicks / r.impressions
                } else {
                    0.0
                };
                DimensionRow {
                    key: r.keys.into_iter().next().unwrap_or_default(),
                    clicks: r.clicks,
                    impressions: r.impressions,
                    ctr,
                    position: r.position,
                }
            })
            .collect();

        Ok(rows)
    }

    // -- Google Analytics 4 integration --

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaAccountSummariesResponse {
        #[serde(default)]
        account_summaries: Vec<GaAccountSummary>,
        #[serde(default)]
        next_page_token: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaAccountSummary {
        #[serde(default)]
        property_summaries: Vec<GaPropertySummary>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaPropertySummary {
        property: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaPropertyDetail {
        #[serde(default)]
        data_streams: Vec<GaDataStream>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaDataStream {
        #[serde(default)]
        r#type: String,
        #[serde(default)]
        web_stream_data: Option<GaWebStreamData>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaWebStreamData {
        #[serde(default)]
        default_uri: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaRunReportResponse {
        #[serde(default)]
        rows: Vec<GaReportRow>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GaReportRow {
        #[serde(default)]
        dimension_values: Vec<GaDimensionValue>,
        #[serde(default)]
        metric_values: Vec<GaMetricValue>,
    }

    #[derive(Deserialize)]
    struct GaDimensionValue {
        #[serde(default)]
        value: String,
    }

    #[derive(Deserialize)]
    struct GaMetricValue {
        #[serde(default)]
        value: String,
    }

    fn normalize_url_for_match(url: &str) -> String {
        url.trim_start_matches("sc-domain:")
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_start_matches("www.")
            .trim_end_matches('/')
            .to_lowercase()
    }

    async fn list_ga_properties(access_token: &str) -> Vec<(String, String)> {
        let client = http_client();
        let mut page_token: Option<String> = None;

        let mut property_ids: Vec<String> = Vec::new();
        loop {
            let mut url =
                "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200"
                    .to_string();
            if let Some(ref token) = page_token {
                url.push_str(&format!("&pageToken={token}"));
            }
            let res = client.get(&url).bearer_auth(access_token).send().await;
            let Ok(res) = res else { break };
            if !res.status().is_success() {
                let status = res.status();
                let body = res.text().await.unwrap_or_default();
                eprintln!("[ga] accountSummaries error: {status} - {body}");
                break;
            }
            let Ok(data) = res.json::<GaAccountSummariesResponse>().await else {
                break;
            };
            property_ids.extend(
                data.account_summaries
                    .iter()
                    .flat_map(|acct| acct.property_summaries.iter())
                    .map(|prop| prop.property.clone()),
            );
            if data.next_page_token.is_none() {
                break;
            }
            page_token = data.next_page_token;
        }

        eprintln!(
            "[ga] found {} GA4 properties, fetching data streams...",
            property_ids.len()
        );

        let mut tasks = tokio::task::JoinSet::new();
        for prop_id in property_ids {
            let client = client.clone();
            let token = access_token.to_string();
            tasks.spawn(async move {
                let url =
                    format!("https://analyticsadmin.googleapis.com/v1beta/{prop_id}/dataStreams");
                let res = client.get(&url).bearer_auth(&token).send().await;
                let Ok(res) = res else {
                    return Vec::new();
                };
                if !res.status().is_success() {
                    return Vec::new();
                }
                let Ok(data) = res.json::<GaPropertyDetail>().await else {
                    return Vec::new();
                };
                let numeric_id = prop_id
                    .strip_prefix("properties/")
                    .unwrap_or(&prop_id)
                    .to_string();
                data.data_streams
                    .iter()
                    .filter(|s| s.r#type == "WEB_DATA_STREAM")
                    .filter_map(|s| s.web_stream_data.as_ref())
                    .filter(|w| !w.default_uri.is_empty())
                    .map(|w| (numeric_id.clone(), normalize_url_for_match(&w.default_uri)))
                    .collect::<Vec<_>>()
            });
        }

        let mut result = Vec::new();
        while let Some(Ok(entries)) = tasks.join_next().await {
            result.extend(entries);
        }

        eprintln!("[ga] resolved {} GA4 property-url mappings", result.len());
        result
    }

    pub async fn fetch_ga_daily_metric(
        access_token: &str,
        property_id: &str,
        metric: &str,
        days: u64,
    ) -> Result<Vec<(String, f64)>, String> {
        let client = http_client();
        let (start_date, _) = date_range(days);

        let body = serde_json::json!({
            "dateRanges": [{"startDate": start_date, "endDate": "yesterday"}],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": metric}],
            "orderBys": [{"dimension": {"dimensionName": "date"}}],
            "limit": 500,
        });

        let url = format!(
            "https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport"
        );

        let res = client
            .post(&url)
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("GA4 API error {status}: {body}"));
        }

        let data: GaRunReportResponse = res.json().await.map_err(|e| e.to_string())?;

        let rows: Vec<(String, f64)> = data
            .rows
            .into_iter()
            .filter_map(|r| {
                let date_raw = r.dimension_values.first()?.value.clone();
                let val: f64 = r.metric_values.first()?.value.parse().unwrap_or(0.0);
                if date_raw.len() == 8 {
                    let formatted = format!(
                        "{}-{}-{}",
                        &date_raw[0..4],
                        &date_raw[4..6],
                        &date_raw[6..8]
                    );
                    Some((formatted, val))
                } else {
                    Some((date_raw, val))
                }
            })
            .collect();

        Ok(rows)
    }

    pub async fn fetch_ga_daily_sessions(
        access_token: &str,
        property_id: &str,
        days: u64,
    ) -> Result<Vec<(String, f64)>, String> {
        fetch_ga_daily_metric(access_token, property_id, "sessions", days).await
    }

    pub async fn resolve_ga_property(access_token: &str, site_url: &str) -> Option<String> {
        let ga_props = list_ga_properties(access_token).await;
        let normalized_site = normalize_url_for_match(site_url);

        if !site_url.is_empty() {
            eprintln!(
                "[ga-resolve] site_url={:?} normalized={:?} ga_props={:?}",
                site_url,
                normalized_site,
                ga_props
                    .iter()
                    .map(|(id, u)| (id.as_str(), u.as_str()))
                    .collect::<Vec<_>>()
            );
        }

        ga_props
            .into_iter()
            .find(|(_, ga_url)| {
                *ga_url == normalized_site
                    || normalized_site.contains(ga_url.as_str())
                    || ga_url.contains(normalized_site.as_str())
            })
            .map(|(id, _)| id)
    }
}
