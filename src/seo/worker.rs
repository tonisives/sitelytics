use super::{Config, crawl, google};
use crate::state::AppState;
use chrono::Utc;
use rdkafka::{
    ClientConfig, Message,
    consumer::{CommitMode, Consumer, StreamConsumer},
    producer::{FutureProducer, FutureRecord},
};
use serde_json::{Value, json};
use sqlx::Row;
use std::time::Duration;
use uuid::Uuid;
const REQUESTS: &str = "sitelytics.seo.browser.requests";
const RESPONSES: &str = "sitelytics.seo.browser.responses";
async fn publish(producer: &FutureProducer, key: &str, value: &Value) -> Result<(), String> {
    producer
        .send(
            FutureRecord::to(REQUESTS)
                .key(key)
                .payload(&value.to_string()),
            Duration::from_secs(10),
        )
        .await
        .map_err(|(e, _)| e.to_string())?;
    Ok(())
}
pub async fn run(state: AppState) -> Result<(), String> {
    let brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "redpanda.redpanda.svc.cluster.local:9093".into());
    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .create()
        .map_err(|e| e.to_string())?;
    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "sitelytics-seo-results-v1")
        .set("enable.auto.commit", "false")
        .set("auto.offset.reset", "earliest")
        .create()
        .map_err(|e| e.to_string())?;
    consumer
        .subscribe(&[RESPONSES])
        .map_err(|e| e.to_string())?;
    let health_state = state.clone();
    let health = tokio::spawn(async move {
        loop {
            let _=sqlx::query("INSERT INTO seo_worker_health(worker) VALUES('seo-worker') ON CONFLICT(worker) DO UPDATE SET heartbeat_at=now()").execute(&health_state.db).await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    let jobs_state = state.clone();
    let jobs = tokio::spawn(async move {
        loop {
            if let Err(e) = tick(&jobs_state, &producer).await {
                tracing::error!(error=%e,"SEO worker pass failed");
            }
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
    loop {
        tokio::select! {
         _=tokio::signal::ctrl_c()=>break,
         item=consumer.recv()=>match item{Ok(message)=>{
          let result=match message.payload(){Some(payload)=>ingest(&state,payload).await,None=>Ok(())};
          match result{Ok(())=>{consumer.commit_message(&message,CommitMode::Sync).map_err(|e|e.to_string())?;},Err(e)=>{tracing::error!(error=%e,"SEO result storage failed; stopping before offset commit");jobs.abort();return Err(e);}}
         },Err(e)=>tracing::warn!(error=%e,"SEO result consumer error")}
        }
    }
    jobs.abort();
    health.abort();
    Ok(())
}
async fn tick(state: &AppState, producer: &FutureProducer) -> Result<(), String> {
    sqlx::query("INSERT INTO seo_worker_health(worker) VALUES('seo-worker') ON CONFLICT(worker) DO UPDATE SET heartbeat_at=now()").execute(&state.db).await.map_err(|e|e.to_string())?;
    sqlx::query("UPDATE seo_jobs SET status='failed',error='Job expired; run again',completed_at=now() WHERE status IN ('queued','running','waiting_browser') AND created_at<now()-interval '24 hours'").execute(&state.db).await.map_err(|e|e.to_string())?;
    // A single worker process holds a database advisory lock while executing a job. Recovery only touches abandoned work.
    let mut connection = state.db.acquire().await.map_err(|e| e.to_string())?;
    let lock: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock(7240924)")
        .fetch_one(&mut *connection)
        .await
        .map_err(|e| e.to_string())?;
    if !lock {
        return Ok(());
    }
    let result = work_locked(state, producer).await;
    let _ = sqlx::query("SELECT pg_advisory_unlock(7240924)")
        .execute(&mut *connection)
        .await;
    result
}
async fn work_locked(state: &AppState, producer: &FutureProducer) -> Result<(), String> {
    sqlx::query("UPDATE seo_jobs SET status='queued',started_at=NULL WHERE status='running'")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let mut tx = state.db.begin().await.map_err(|e| e.to_string())?;
    let due=sqlx::query("SELECT d.site_id,d.module,s.config FROM seo_schedules d JOIN seo_sites s ON s.id=d.site_id JOIN users u ON u.id=s.user_id WHERE u.is_admin AND d.next_run_at<=now() AND s.config->'modules'->d.module->>'enabled'='true' FOR UPDATE OF d SKIP LOCKED").fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    for row in due {
        let site: Uuid = row.get("site_id");
        let module: String = row.get("module");
        sqlx::query(
            "INSERT INTO seo_jobs(site_id,module,config) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(site)
        .bind(&module)
        .bind(row.get::<Value, _>("config"))
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        sqlx::query("UPDATE seo_schedules SET next_run_at=now()+interval '7 days' WHERE site_id=$1 AND module=$2").bind(site).bind(module).execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    // Retain structured history; discard rendered evidence after seven days.
    sqlx::query("UPDATE seo_jobs SET result=result-'raw_evidence' WHERE completed_at<now()-interval '7 days' AND result ? 'raw_evidence'").execute(&state.db).await.map_err(|e|e.to_string())?;
    sqlx::query("DELETE FROM seo_jobs WHERE completed_at<now()-interval '12 months'")
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let dispatch=sqlx::query("SELECT j.id,j.module,j.config,j.result,j.created_at FROM seo_jobs j JOIN seo_sites s ON s.id=j.site_id JOIN users u ON u.id=s.user_id WHERE j.status='waiting_browser' AND j.dispatched_at IS NULL AND u.is_admin").fetch_all(&state.db).await.map_err(|e|e.to_string())?;
    for row in dispatch {
        dispatch_row(state, producer, &row).await?;
    }
    let row=sqlx::query("UPDATE seo_jobs SET status='running',started_at=now() WHERE id=(SELECT j.id FROM seo_jobs j JOIN seo_sites s ON s.id=j.site_id JOIN users u ON u.id=s.user_id WHERE j.status='queued' AND u.is_admin ORDER BY j.created_at LIMIT 1) RETURNING *").fetch_optional(&state.db).await.map_err(|e|e.to_string())?;
    let Some(row) = row else { return Ok(()) };
    let id: Uuid = row.get("id");
    let site_id: Uuid = row.get("site_id");
    let module: String = row.get("module");
    let config: Config = serde_json::from_value(row.get("config")).map_err(|e| e.to_string())?;
    let site = sqlx::query("SELECT user_id,site_url FROM seo_sites WHERE id=$1")
        .bind(site_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let result = match module.as_str() {
        "keywords" => {
            google::keywords(
                state,
                id,
                site.get("user_id"),
                &site.get::<String, _>("site_url"),
            )
            .await
        }
        "audit" => crawl::audit(state, id, &config).await,
        _ => Ok(json!({})),
    };
    match result {
        Err(error) => {
            sqlx::query("UPDATE seo_jobs SET status='failed',error=$2,completed_at=now() WHERE id=$1 AND status='running'").bind(id).bind(&error).execute(&state.db).await.map_err(|e|e.to_string())?;
            if error.contains("Reconnect Google") {
                sqlx::query("DELETE FROM seo_schedules WHERE site_id=$1 AND module='keywords'")
                    .bind(site_id)
                    .execute(&state.db)
                    .await
                    .map_err(|e| e.to_string())?;
                sqlx::query("UPDATE seo_sites SET config=jsonb_set(config,'{modules,keywords,weekly}','false') WHERE id=$1").bind(site_id).execute(&state.db).await.map_err(|e|e.to_string())?;
            }
        }
        Ok(result) => {
            let browser = matches!(module.as_str(), "rankings" | "research")
                || module == "audit" && !config.render_urls.is_empty();
            let status = if browser {
                "waiting_browser"
            } else if result["complete"] == false {
                "partial"
            } else {
                "succeeded"
            };
            sqlx::query("UPDATE seo_jobs SET status=$2,result=$3,completed_at=CASE WHEN $2='waiting_browser' THEN NULL ELSE now() END WHERE id=$1 AND status='running'").bind(id).bind(status).bind(result).execute(&state.db).await.map_err(|e|e.to_string())?;
            if browser {
                let row =
                    sqlx::query("SELECT * FROM seo_jobs WHERE id=$1 AND status='waiting_browser'")
                        .bind(id)
                        .fetch_optional(&state.db)
                        .await
                        .map_err(|e| e.to_string())?;
                if let Some(row) = row {
                    dispatch_row(state, producer, &row).await?;
                }
            }
        }
    }
    Ok(())
}
async fn dispatch_row(
    state: &AppState,
    producer: &FutureProducer,
    row: &sqlx::postgres::PgRow,
) -> Result<(), String> {
    let id: Uuid = row.get("id");
    let created: chrono::DateTime<Utc> = row.get("created_at");
    publish(producer,&id.to_string(),&json!({"version":1,"id":id,"kind":row.get::<String,_>("module"),"config":row.get::<Value,_>("config"),"expires_at":created+chrono::Duration::hours(24)})).await?;
    sqlx::query("UPDATE seo_jobs SET dispatched_at=now() WHERE id=$1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
async fn ingest(state: &AppState, payload: &[u8]) -> Result<(), String> {
    let Ok(value) = serde_json::from_slice::<Value>(payload) else {
        return Ok(());
    };
    if value["type"] == "heartbeat" {
        sqlx::query("INSERT INTO seo_worker_health(worker,detail) VALUES('bmux',$1) ON CONFLICT(worker) DO UPDATE SET heartbeat_at=now(),detail=EXCLUDED.detail").bind(&value).execute(&state.db).await.map_err(|e|e.to_string())?;
        return Ok(());
    }
    let Some(id) = value["id"].as_str().and_then(|s| Uuid::parse_str(s).ok()) else {
        return Ok(());
    };
    let status = value["status"]
        .as_str()
        .filter(|s| ["succeeded", "partial", "failed"].contains(s))
        .unwrap_or("failed");
    sqlx::query("UPDATE seo_jobs SET status=CASE WHEN result->>'complete'='false' AND $2='succeeded' THEN 'partial' ELSE $2 END,result=COALESCE(result,'{}'::jsonb)||$3,error=$4,completed_at=now() WHERE id=$1 AND status='waiting_browser'").bind(id).bind(status).bind(&value["result"]).bind(value["error"].as_str()).execute(&state.db).await.map_err(|e|e.to_string())?;
    Ok(())
}
