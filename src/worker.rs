use std::time::Duration;

use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use rdkafka::{
    ClientConfig, Message,
    consumer::{CommitMode, Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::state::AppState;

const BROWSER_REQUEST_TOPIC: &str = "sitelytics.aeo.browser.requests";
const BROWSER_RESPONSE_TOPIC: &str = "tskr.scrape.responses";
const PROVIDERS: [&str; 3] = ["chatgpt", "perplexity", "claude"];

#[derive(Deserialize)]
struct BrowserResponse {
    request_id: String,
    status: String,
    content: Option<String>,
    error: Option<BrowserError>,
    duration_ms: u64,
}

#[derive(Deserialize)]
struct BrowserError {
    code: String,
}

#[derive(Deserialize)]
struct AiAnswer {
    answer: String,
    #[serde(default)]
    citations: Vec<String>,
}

#[derive(Deserialize)]
struct RemoteResponse {
    response: String,
    #[serde(default)]
    exit_code: Option<i32>,
    #[serde(default, rename = "exitCode")]
    exit_code_camel: Option<i32>,
}

#[derive(Deserialize, Default)]
struct Classification {
    level: String,
    rank: Option<i32>,
    evidence: Option<String>,
    #[serde(default)]
    competitors: Vec<String>,
}

#[derive(Serialize)]
struct RemoteRequest<'a> {
    prompt: &'a str,
    source: &'static str,
    #[serde(rename = "modelTier")]
    model_tier: &'static str,
    #[serde(rename = "reasoningEffort")]
    reasoning_effort: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'static str>,
}

pub async fn run(state: AppState) -> Result<(), String> {
    let brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "redpanda.redpanda.svc.cluster.local:9093".into());
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .create()
        .map_err(|error| error.to_string())?;
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "sitelytics-aeo-worker-v1")
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", "latest")
        .create()
        .map_err(|error| error.to_string())?;
    consumer
        .subscribe(&[BROWSER_RESPONSE_TOPIC])
        .map_err(|error| error.to_string())?;
    let scheduler_state = state.clone();
    let scheduler_producer = producer.clone();
    let scheduler = tokio::spawn(async move {
        loop {
            if let Err(error) = schedule_due(&scheduler_state, &scheduler_producer).await {
                tracing::error!(%error, "AEO scheduler pass failed");
            }
            if let Err(error) = cleanup_raw_answers(&scheduler_state).await {
                tracing::error!(%error, "AEO retention cleanup failed");
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    let mut stream = consumer.stream();
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => break,
            message = stream.next() => if let Some(message) = message {
                match message {
                    Ok(message) => {
                        if let Some(payload) = message.payload() {
                            if let Ok(response) = serde_json::from_slice::<BrowserResponse>(payload) {
                                if response.request_id.starts_with("aeo-") {
                                    if let Err(error) = complete_browser_sample(&state, response).await { tracing::error!(%error, "AEO browser response failed"); }
                                }
                            }
                        }
                        let _ = consumer.commit_message(&message, CommitMode::Async);
                    }
                    Err(error) => tracing::warn!(%error, "AEO response consumer error"),
                }
            }
        }
    }
    scheduler.abort();
    Ok(())
}

async fn schedule_due(state: &AppState, producer: &FutureProducer) -> Result<(), String> {
    let mut tx = state.db.begin().await.map_err(|error| error.to_string())?;
    let due = sqlx::query(
        "SELECT q.id,q.prompt,q.cadence::text AS cadence,q.next_run_at,p.brand_name,p.owned_domain,p.aliases \
         FROM aeo_queries q JOIN aeo_properties p ON p.id=q.property_id \
         WHERE q.active AND q.next_run_at<=now() ORDER BY q.next_run_at FOR UPDATE OF q SKIP LOCKED LIMIT 3"
    ).fetch_all(&mut *tx).await.map_err(|error| error.to_string())?;
    let mut jobs = Vec::new();
    for row in due {
        let query_id: Uuid = row.try_get("id").map_err(|error| error.to_string())?;
        let scheduled_for: DateTime<Utc> = row
            .try_get("next_run_at")
            .map_err(|error| error.to_string())?;
        let run_id: Uuid = sqlx::query_scalar("INSERT INTO aeo_runs(query_id,scheduled_for,status) VALUES($1,$2,'running') ON CONFLICT(query_id,scheduled_for) DO UPDATE SET status='running' RETURNING id")
            .bind(query_id).bind(scheduled_for).fetch_one(&mut *tx).await.map_err(|error| error.to_string())?;
        let cadence: String = row.try_get("cadence").map_err(|error| error.to_string())?;
        sqlx::query("UPDATE aeo_queries SET next_run_at=CASE WHEN $2='weekly' THEN $3+interval '7 days' ELSE $3+interval '1 month' END,updated_at=now() WHERE id=$1")
            .bind(query_id).bind(&cadence).bind(scheduled_for).execute(&mut *tx).await.map_err(|error| error.to_string())?;
        let prompt: String = row.try_get("prompt").map_err(|error| error.to_string())?;
        let brand: String = row
            .try_get("brand_name")
            .map_err(|error| error.to_string())?;
        let domain: String = row
            .try_get("owned_domain")
            .map_err(|error| error.to_string())?;
        let aliases: Vec<String> = row.try_get("aliases").unwrap_or_default();
        for provider in PROVIDERS {
            for sample_number in 1_i16..=3 {
                let key = transport_key(run_id, provider, sample_number);
                sqlx::query("INSERT INTO aeo_samples(run_id,provider,sample_number,status,transport_key) VALUES($1,$2::aeo_provider,$3,'queued',$4) ON CONFLICT(run_id,provider,sample_number) DO NOTHING")
                    .bind(run_id).bind(provider).bind(sample_number).bind(&key).execute(&mut *tx).await.map_err(|error| error.to_string())?;
                jobs.push((
                    run_id,
                    provider.to_string(),
                    sample_number,
                    key,
                    prompt.clone(),
                    brand.clone(),
                    domain.clone(),
                    aliases.clone(),
                ));
            }
        }
    }
    tx.commit().await.map_err(|error| error.to_string())?;
    for (run_id, provider, sample, key, prompt, brand, domain, aliases) in jobs {
        let circuit_open: bool = sqlx::query_scalar("SELECT COALESCE(circuit_open_until>now(),false) FROM aeo_provider_health WHERE provider=$1::aeo_provider")
            .bind(&provider).fetch_optional(&state.db).await.map_err(|error| error.to_string())?.unwrap_or(false);
        if circuit_open {
            sqlx::query("UPDATE aeo_samples SET status='unknown',error_code='provider_circuit_open',completed_at=now() WHERE transport_key=$1")
                .bind(&key).execute(&state.db).await.map_err(|error| error.to_string())?;
            finish_run_if_complete(state, run_id).await?;
            continue;
        }
        if provider == "claude" {
            let state = state.clone();
            tokio::spawn(async move {
                let _ = run_claude_sample(
                    &state, run_id, sample, &key, &prompt, &brand, &domain, &aliases,
                )
                .await;
            });
        } else {
            publish_browser_job(producer, &provider, &key, &prompt).await?;
            sqlx::query(
                "UPDATE aeo_samples SET status='running',started_at=now() WHERE transport_key=$1",
            )
            .bind(&key)
            .execute(&state.db)
            .await
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

async fn publish_browser_job(
    producer: &FutureProducer,
    provider: &str,
    key: &str,
    prompt: &str,
) -> Result<(), String> {
    let url = if provider == "chatgpt" {
        "https://chatgpt.com/"
    } else {
        "https://www.perplexity.ai/"
    };
    let request = serde_json::json!({
        "schema_version":1,"request_id":key,"lane":"headed","domain_key":provider,"service_class":"batch","network":{},
        "retry":{"max_attempts":1,"initial_delay_ms":5000,"max_delay_ms":5000},"attempt":1,"url":url,
        "recipe":{"kind":"ai_answer","provider":provider,"prompt":prompt},"output_format":"json","headers":{},"timeout_ms":180000,
        "wait_after_load_ms":1000,"max_content_bytes":1048576,"callback":{"kind":"sitelytics_aeo","data":{}},"enqueued_at":Utc::now()
    });
    let payload = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    producer
        .send(
            FutureRecord::to(BROWSER_REQUEST_TOPIC)
                .key(key)
                .payload(&payload),
            Duration::from_secs(10),
        )
        .await
        .map_err(|(error, _)| error.to_string())?;
    Ok(())
}

async fn run_claude_sample(
    state: &AppState,
    run_id: Uuid,
    sample_number: i16,
    key: &str,
    prompt: &str,
    brand: &str,
    domain: &str,
    aliases: &[String],
) -> Result<(), String> {
    sqlx::query("UPDATE aeo_samples SET status='running',started_at=now() WHERE transport_key=$1")
        .bind(key)
        .execute(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    let started = std::time::Instant::now();
    match remote_prompt(state, prompt, "medium", "medium", Some("claude")).await {
        Ok(answer) => {
            store_answer(
                state,
                run_id,
                "claude",
                sample_number,
                &answer,
                &[],
                started.elapsed().as_millis() as i32,
                brand,
                domain,
                aliases,
            )
            .await
        }
        Err(error) => fail_sample(state, key, &error, started.elapsed().as_millis() as i32).await,
    }
}

async fn complete_browser_sample(
    state: &AppState,
    response: BrowserResponse,
) -> Result<(), String> {
    let row = sqlx::query("SELECT s.run_id,s.provider::text AS provider,s.sample_number,p.brand_name,p.owned_domain,p.aliases FROM aeo_samples s JOIN aeo_runs r ON r.id=s.run_id JOIN aeo_queries q ON q.id=r.query_id JOIN aeo_properties p ON p.id=q.property_id WHERE s.transport_key=$1")
        .bind(&response.request_id).fetch_optional(&state.db).await.map_err(|error| error.to_string())?;
    let Some(row) = row else { return Ok(()) };
    if response.status != "succeeded" {
        let code = response
            .error
            .map_or_else(|| "browser_failed".into(), |error| error.code);
        return fail_sample(
            state,
            &response.request_id,
            &code,
            response.duration_ms as i32,
        )
        .await;
    }
    let content = response
        .content
        .ok_or_else(|| "browser response omitted content".to_string())?;
    let answer: AiAnswer = serde_json::from_str(&content).map_err(|error| error.to_string())?;
    store_answer(
        state,
        row.get("run_id"),
        &row.get::<String, _>("provider"),
        row.get("sample_number"),
        &answer.answer,
        &answer.citations,
        response.duration_ms as i32,
        &row.get::<String, _>("brand_name"),
        &row.get::<String, _>("owned_domain"),
        &row.get::<Vec<String>, _>("aliases"),
    )
    .await
}

async fn store_answer(
    state: &AppState,
    run_id: Uuid,
    provider: &str,
    sample: i16,
    answer: &str,
    citations: &[String],
    latency_ms: i32,
    brand: &str,
    domain: &str,
    aliases: &[String],
) -> Result<(), String> {
    let classification = classify(state, answer, brand, domain, aliases).await;
    let cited = citations
        .iter()
        .any(|url| normalized(url).contains(&normalized(domain)))
        || normalized(answer).contains(&normalized(domain));
    sqlx::query("UPDATE aeo_samples SET status='succeeded',level=$4::aeo_visibility_level,rank=$5,owned_domain_cited=$6,evidence=$7,citations=$8,competitors=$9,raw_answer=$10,latency_ms=$11,completed_at=now(),raw_expires_at=now()+interval '30 days' WHERE run_id=$1 AND provider=$2::aeo_provider AND sample_number=$3")
        .bind(run_id).bind(provider).bind(sample).bind(&classification.level).bind(classification.rank).bind(cited).bind(classification.evidence)
        .bind(serde_json::json!(citations)).bind(serde_json::json!(classification.competitors)).bind(answer).bind(latency_ms)
        .execute(&state.db).await.map_err(|error| error.to_string())?;
    record_health(state, provider, None).await?;
    finish_run_if_complete(state, run_id).await
}

async fn classify(
    state: &AppState,
    answer: &str,
    brand: &str,
    domain: &str,
    aliases: &[String],
) -> Classification {
    let normalized_answer = normalized(answer);
    let mentioned = aliases
        .iter()
        .any(|alias| normalized_answer.contains(&normalized(alias)))
        || normalized_answer.contains(&normalized(brand));
    let cited = normalized_answer.contains(&normalized(domain));
    if !mentioned {
        return Classification {
            level: if cited { "cited" } else { "absent" }.into(),
            ..Classification::default()
        };
    }
    let instruction = format!(
        "Classify this AI answer's treatment of the target company. Return JSON only: {{\"level\":\"mentioned|recommended|top_pick\",\"rank\":integer|null,\"evidence\":\"short excerpt or paraphrase\",\"competitors\":[\"names in order\"]}}. top_pick means the single primary/best choice; recommended means it is explicitly recommended or in a recommended shortlist; mentioned is neutral. Rank is the company's ordinal position in an ordered list. Target brand: {brand}. Aliases: {}. Answer:\n{answer}",
        aliases.join(", ")
    );
    if let Ok(raw) = remote_prompt(state, &instruction, "cheap", "low", None).await {
        if let Some(value) =
            json_object(&raw).and_then(|value| serde_json::from_str::<Classification>(value).ok())
        {
            if matches!(
                value.level.as_str(),
                "mentioned" | "recommended" | "top_pick"
            ) {
                return value;
            }
        }
    }
    Classification {
        level: "mentioned".into(),
        evidence: Some("Brand name detected in the answer".into()),
        ..Classification::default()
    }
}

async fn remote_prompt(
    state: &AppState,
    prompt: &str,
    tier: &'static str,
    effort: &'static str,
    provider: Option<&'static str>,
) -> Result<String, String> {
    let endpoint = std::env::var("AGENT_REMOTE_URL")
        .or_else(|_| std::env::var("CLAUDE_REMOTE_URL"))
        .map_err(|_| "AGENT_REMOTE_URL is not configured".to_string())?;
    let token = std::env::var("AGENT_REMOTE_API_KEY")
        .or_else(|_| std::env::var("CLAUDE_REMOTE_API_KEY"))
        .map_err(|_| "AGENT_REMOTE_API_KEY is not configured".to_string())?;
    let response = state
        .http
        .post(endpoint)
        .bearer_auth(token)
        .json(&RemoteRequest {
            prompt,
            source: "sitelytics-aeo",
            model_tier: tier,
            reasoning_effort: effort,
            provider,
        })
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("agent_remote_{}", response.status().as_u16()));
    }
    let result: RemoteResponse = response.json().await.map_err(|error| error.to_string())?;
    if result.exit_code.or(result.exit_code_camel).unwrap_or(1) != 0 {
        return Err("agent_remote_exit".into());
    }
    Ok(result.response)
}

async fn fail_sample(
    state: &AppState,
    key: &str,
    code: &str,
    latency_ms: i32,
) -> Result<(), String> {
    let blocked =
        code.contains("blocked") || code.contains("auth_required") || code.contains("rate_limit");
    let row = sqlx::query("UPDATE aeo_samples SET status=CASE WHEN $2 THEN 'blocked'::aeo_job_status ELSE 'failed'::aeo_job_status END,error_code=$3,latency_ms=$4,completed_at=now() WHERE transport_key=$1 RETURNING run_id,provider::text AS provider")
        .bind(key).bind(blocked).bind(code).bind(latency_ms).fetch_one(&state.db).await.map_err(|error| error.to_string())?;
    let provider: String = row.get("provider");
    record_health(state, &provider, Some(code)).await?;
    finish_run_if_complete(state, row.get("run_id")).await
}

async fn record_health(
    state: &AppState,
    provider: &str,
    error: Option<&str>,
) -> Result<(), String> {
    if let Some(code) = error {
        let row = sqlx::query("INSERT INTO aeo_provider_health(provider,last_error_code,consecutive_failures) VALUES($1::aeo_provider,$2,1) ON CONFLICT(provider) DO UPDATE SET last_error_code=$2,consecutive_failures=aeo_provider_health.consecutive_failures+1,updated_at=now(),circuit_open_until=CASE WHEN aeo_provider_health.consecutive_failures+1>=3 THEN now()+interval '1 hour' ELSE aeo_provider_health.circuit_open_until END RETURNING consecutive_failures")
            .bind(provider).bind(code).fetch_one(&state.db).await.map_err(|error| error.to_string())?;
        if row.get::<i32, _>("consecutive_failures") == 3 {
            notify_circuit(state, provider, code).await;
        }
    } else {
        sqlx::query("INSERT INTO aeo_provider_health(provider,last_success_at,consecutive_failures) VALUES($1::aeo_provider,now(),0) ON CONFLICT(provider) DO UPDATE SET last_success_at=now(),consecutive_failures=0,circuit_open_until=NULL,last_error_code=NULL,updated_at=now()")
            .bind(provider).execute(&state.db).await.map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn finish_run_if_complete(state: &AppState, run_id: Uuid) -> Result<(), String> {
    sqlx::query("UPDATE aeo_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM aeo_samples WHERE run_id=$1 AND status IN('queued','running')) THEN 'running'::aeo_job_status WHEN EXISTS(SELECT 1 FROM aeo_samples WHERE run_id=$1 AND status='succeeded') THEN 'succeeded'::aeo_job_status ELSE 'unknown'::aeo_job_status END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM aeo_samples WHERE run_id=$1 AND status IN('queued','running')) THEN now() ELSE NULL END WHERE id=$1")
        .bind(run_id).execute(&state.db).await.map_err(|error| error.to_string())?;
    Ok(())
}

async fn cleanup_raw_answers(state: &AppState) -> Result<(), String> {
    sqlx::query("UPDATE aeo_samples SET raw_answer=NULL WHERE raw_expires_at<now() AND raw_answer IS NOT NULL").execute(&state.db).await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM user_sessions WHERE expires_at<now()")
        .execute(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn notify_circuit(state: &AppState, provider: &str, code: &str) {
    let Ok(endpoint) = std::env::var("TELEGRAM_ALERT_URL") else {
        return;
    };
    let _ = state.http.post(endpoint).json(&serde_json::json!({"text":format!("Sitelytics AEO provider circuit opened: {provider} ({code})")})).send().await;
}

fn transport_key(run_id: Uuid, provider: &str, sample: i16) -> String {
    format!("aeo-{run_id}-{provider}-{sample}")
}
fn normalized(value: &str) -> String {
    value.nfkc().collect::<String>().to_lowercase()
}
fn json_object(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let end = value.rfind('}')?;
    value.get(start..=end)
}

#[allow(dead_code)]
fn stable_hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
