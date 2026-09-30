use super::{Config, crawl, google};
use crate::state::AppState;
use futures_util::{StreamExt, stream};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::time::Duration;
use uuid::Uuid;

pub fn seeds(config: &Config) -> Vec<String> {
    let topics: Vec<String> = if config.keyword_seeds.is_empty() {
        config
            .product_context
            .split([',', ';', '.', '\n'])
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .take(3)
            .map(str::to_string)
            .collect()
    } else {
        config.keyword_seeds.clone()
    };
    let mut queries = BTreeSet::new();
    let topics = if topics.is_empty() {
        config.keywords.iter().take(3).cloned().collect()
    } else {
        topics
    };
    for topic in topics.into_iter().take(8) {
        queries.insert(topic.clone());
        for suffix in [" discovery", " research", " software", " tools"] {
            if let Some(base) = topic.strip_suffix(suffix) {
                queries.insert(base.to_string());
            }
        }
        queries.insert(format!("{topic} for"));
    }
    queries.into_iter().take(16).collect()
}

pub async fn keywords(state: &AppState, job: Uuid, config: &Config) -> Result<Value, String> {
    let queries = seeds(config);
    let results = stream::iter(queries.iter().cloned())
        .map(|seed| async move {
            if !crawl::active(state, job).await? {
                return Err("Cancelled".to_string());
            }
            let response = state
                .http
                .get("https://suggestqueries.google.com/complete/search")
                .query(&[
                    ("client", "firefox"),
                    ("q", seed.as_str()),
                    ("hl", config.language.as_str()),
                    ("gl", config.country.as_str()),
                ])
                .timeout(Duration::from_secs(15))
                .send()
                .await
                .map_err(|_| format!("Suggestions unavailable for {seed}"))?;
            if !response.status().is_success() {
                return Err(format!(
                    "Suggestions returned HTTP {} for {seed}",
                    response.status()
                ));
            }
            let value: Value = response
                .json()
                .await
                .map_err(|_| format!("Invalid suggestions for {seed}"))?;
            Ok((seed, value[1].as_array().cloned().unwrap_or_default()))
        })
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    let mut ideas: BTreeMap<String, Value> = BTreeMap::new();
    let mut errors = vec![];
    for result in results {
        match result {
            Ok((seed, suggestions)) => {
                for keyword in suggestions.iter().filter_map(Value::as_str) {
                    if keyword.eq_ignore_ascii_case(&seed)
                        || keyword.len() > 200
                        || keyword.len() < 3
                        || (config.language == "en" && !keyword.is_ascii())
                    {
                        continue;
                    }
                    let entry = ideas.entry(keyword.to_lowercase()).or_insert_with(
                        || json!({"keyword":keyword,"source":"Google autocomplete","seeds":[]}),
                    );
                    if let Some(seeds) = entry["seeds"].as_array_mut() {
                        if !seeds.iter().any(|v| v == &seed) {
                            seeds.push(json!(seed));
                        }
                    }
                }
            }
            Err(error) => errors.push(json!({"error":error})),
        }
    }
    Ok(
        json!({"ideas":ideas.into_values().take(150).collect::<Vec<_>>(),"discovery":{"source":"Google autocomplete","queries":queries,"collected_at":chrono::Utc::now(),"note":"Search suggestions are keyword ideas. Search volume and difficulty are not available from this source."},"discovery_errors":errors}),
    )
}

pub async fn report(
    state: &AppState,
    job: Uuid,
    user: Uuid,
    site: &str,
    config: &Config,
) -> Result<Value, String> {
    let (performance, discovery) = tokio::join!(
        google::keywords(state, job, user, site),
        keywords(state, job, config)
    );
    let mut result = match performance {
        Ok(value) => value,
        Err(error) => json!({"rows":[],"performance_errors":[{"error":error}],"complete":false}),
    };
    let discovery = discovery?;
    if let Some(object) = result.as_object_mut() {
        if let Some(fields) = discovery.as_object() {
            object.extend(
                fields
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
        }
    }
    if discovery["discovery_errors"]
        .as_array()
        .is_some_and(|e| !e.is_empty())
    {
        result["complete"] = json!(false);
    }
    let rows = result["rows"].as_array().cloned().unwrap_or_default();
    let performance_available = result["performance_errors"].is_null();
    if let Some(ideas) = result["ideas"].as_array_mut() {
        for idea in ideas {
            let keyword = idea["keyword"].as_str().unwrap_or("");
            let matches: Vec<&Value> = rows
                .iter()
                .filter(|r| {
                    r["keyword"]
                        .as_str()
                        .is_some_and(|q| q.eq_ignore_ascii_case(keyword))
                })
                .collect();
            let impressions: f64 = matches
                .iter()
                .filter_map(|r| r["impressions"].as_f64())
                .sum();
            idea["owned_impressions"] = json!(performance_available.then_some(impressions));
            idea["owned_position"] = json!((impressions > 0.0).then(|| {
                matches
                    .iter()
                    .map(|r| {
                        r["position"].as_f64().unwrap_or(0.0)
                            * r["impressions"].as_f64().unwrap_or(0.0)
                    })
                    .sum::<f64>()
                    / impressions
            }));
            idea["opportunity"] = json!(if !performance_available {
                "site coverage unavailable"
            } else if impressions > 0.0 {
                "existing query"
            } else {
                "new keyword idea"
            });
        }
    }
    result["source"] = json!("Keyword discovery and Google Search Console");
    result["collected_at"] = json!(chrono::Utc::now());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn research_topics_are_independent_of_tracked_keywords() {
        let mut config = Config::initial("sc-domain:example.com");
        config.keyword_seeds = vec!["business idea discovery".into()];
        assert!(seeds(&config).contains(&"business idea".to_string()));
        assert!(!seeds(&config).is_empty());
        assert!(config.keywords.is_empty());
    }
}
