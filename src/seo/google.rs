use crate::{identity, state::AppState};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use uuid::Uuid;
#[derive(Clone, Deserialize, Serialize, Default)]
struct Row {
    #[serde(default)]
    keys: Vec<String>,
    #[serde(default)]
    clicks: f64,
    #[serde(default)]
    impressions: f64,
    #[serde(default)]
    ctr: f64,
    #[serde(default)]
    position: f64,
}
#[derive(Deserialize)]
struct Rows {
    #[serde(default)]
    rows: Vec<Row>,
}
async fn period(
    state: &AppState,
    job: Uuid,
    token: &str,
    site: &str,
    start: chrono::NaiveDate,
    end: chrono::NaiveDate,
) -> Result<(Vec<Row>, bool), String> {
    let mut all = vec![];
    for offset in (0..100_000).step_by(25_000) {
        if !super::crawl::active(state, job).await? {
            return Err("Cancelled".into());
        }
        let response=state.http.post(format!("https://www.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query",urlencoding::encode(site))).bearer_auth(token).timeout(std::time::Duration::from_secs(60)).json(&json!({"startDate":start.to_string(),"endDate":end.to_string(),"dimensions":["query","page"],"rowLimit":25000,"startRow":offset,"dataState":"final","type":"web"})).send().await.map_err(|_|"Google request failed")?;
        if !response.status().is_success() {
            return Err(if matches!(response.status().as_u16(), 401 | 403) {
                "Reconnect Google: property access expired".into()
            } else {
                format!("Google request failed ({})", response.status())
            });
        }
        let data: Rows = response
            .json()
            .await
            .map_err(|_| "Invalid Google response")?;
        let count = data.rows.len();
        all.extend(data.rows);
        if count < 25000 {
            return Ok((all, false));
        }
    }
    Ok((all, true))
}
pub async fn keywords(
    state: &AppState,
    job: Uuid,
    user: Uuid,
    site: &str,
) -> Result<Value, String> {
    let token = identity::access_token_for_user(state, user)
        .await
        .map_err(|_| "Reconnect Google to resume keyword research")?;
    let end = Utc::now().date_naive() - Duration::days(3);
    let start = end - Duration::days(27);
    let previous_end = start - Duration::days(1);
    let previous_start = previous_end - Duration::days(27);
    let (mut current, capped) = period(state, job, &token, site, start, end).await?;
    let (previous, previous_capped) =
        period(state, job, &token, site, previous_start, previous_end).await?;
    let previous: BTreeMap<Vec<String>, Row> =
        previous.into_iter().map(|r| (r.keys.clone(), r)).collect();
    let current_keys: std::collections::HashSet<Vec<String>> =
        current.iter().map(|r| r.keys.clone()).collect();
    for (keys, row) in &previous {
        if !current_keys.contains(keys) && row.clicks > 0.0 {
            current.push(Row {
                keys: keys.clone(),
                ..Row::default()
            });
        }
    }
    let mut rows:Vec<Value>=current.into_iter().map(|r|{let before=previous.get(&r.keys);let delta=r.clicks-before.map_or(0.0,|p|p.clicks);let mut signals=vec![];
  if before.is_some_and(|p|p.clicks>=5.0) && delta<0.0{signals.push("declining_clicks");}if r.impressions>=100.0 && r.ctr<0.02{signals.push("low_ctr");}if (4.0..=20.0).contains(&r.position){signals.push("near_page_one");}
  json!({"keyword":r.keys.first(),"page":r.keys.get(1),"clicks":r.clicks,"impressions":r.impressions,"ctr":r.ctr,"position":if r.impressions>0.0{Some(r.position)}else{None},"previous_clicks":before.map(|p|p.clicks),"click_delta":before.map(|_|delta),"signals":signals})}).collect();
    rows.sort_by(|a, b| {
        b["impressions"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["impressions"].as_f64().unwrap_or(0.0))
    });
    Ok(
        json!({"source":"Google Search Console","collected_at":Utc::now(),"period":{"start":start,"end":end,"previous_start":previous_start,"previous_end":previous_end},"rows":rows,"complete":!capped && !previous_capped,"coverage":{"row_limit_per_period":100000,"capped":capped||previous_capped,"note":"Google may omit anonymized queries and return only top rows. Impressions are for this property, not global search volume."}}),
    )
}
