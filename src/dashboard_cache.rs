use crate::api::DashboardData;
use std::{
    collections::HashMap,
    future::Future,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

type Key = (Uuid, u64);
type Slots = HashMap<Key, (Instant, Arc<Slot>)>;
const FRESH: Duration = Duration::from_secs(300);
const STALE: Duration = Duration::from_secs(3600);
const MAX_ENTRIES: usize = 256;

#[derive(Default)]
struct Slot {
    value: RwLock<Option<(Instant, DashboardData)>>,
    refresh: Arc<Mutex<()>>,
}

#[derive(Clone, Default)]
pub struct DashboardCache {
    slots: Arc<Mutex<Slots>>,
}

impl DashboardCache {
    pub async fn get<F, Fut>(&self, key: Key, fetch: F) -> Result<DashboardData, String>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<DashboardData, String>> + Send + 'static,
    {
        let slot = {
            let mut slots = self.slots.lock().await;
            if !slots.contains_key(&key) && slots.len() >= MAX_ENTRIES {
                let oldest = slots
                    .iter()
                    .min_by_key(|(_, (used, _))| *used)
                    .map(|(key, _)| *key);
                if let Some(oldest) = oldest {
                    slots.remove(&oldest);
                }
            }
            let (used, slot) = slots
                .entry(key)
                .or_insert_with(|| (Instant::now(), Arc::new(Slot::default())));
            *used = Instant::now();
            Arc::clone(slot)
        };
        let cached = slot.value.read().await.clone();
        if let Some((at, data)) = cached {
            if at.elapsed() < FRESH {
                tracing::info!(days = key.1, "GSC dashboard cache hit");
                return Ok(data);
            }
            if at.elapsed() < STALE {
                if let Ok(guard) = Arc::clone(&slot.refresh).try_lock_owned() {
                    tokio::spawn(async move {
                        let _guard = guard;
                        match fetch().await {
                            Ok(data) => *slot.value.write().await = Some((Instant::now(), data)),
                            Err(error) => {
                                tracing::warn!(%error, "GSC dashboard background refresh failed")
                            }
                        }
                    });
                }
                tracing::info!(days = key.1, "GSC dashboard served while refreshing");
                return Ok(data);
            }
        }
        let _guard = slot.refresh.lock().await;
        // Another request may have filled this slot while we waited.
        if let Some((at, data)) = slot.value.read().await.as_ref() {
            if at.elapsed() < FRESH {
                return Ok(data.clone());
            }
        }
        let data = fetch().await?;
        *slot.value.write().await = Some((Instant::now(), data.clone()));
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::GscMetrics;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn data() -> DashboardData {
        DashboardData {
            properties: vec![],
            totals: GscMetrics {
                clicks: 0.,
                impressions: 0.,
                ctr: 0.,
                position: 0.,
            },
            fetched_at: "test".into(),
        }
    }

    #[tokio::test]
    async fn coalesces_requests_and_isolates_users_and_ranges() -> Result<(), String> {
        let cache = DashboardCache::default();
        let calls = Arc::new(AtomicUsize::new(0));
        let user = Uuid::new_v4();
        let fetch = || {
            let calls = Arc::clone(&calls);
            move || async move {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(10)).await;
                Ok(data())
            }
        };
        let (first, second) = tokio::join!(
            cache.get((user, 28), fetch()),
            cache.get((user, 28), fetch())
        );
        first?;
        second?;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        cache.get((user, 28), fetch()).await?;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        cache.get((user, 7), fetch()).await?;
        cache.get((Uuid::new_v4(), 28), fetch()).await?;
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        Ok(())
    }

    #[tokio::test]
    async fn upstream_failure_is_not_cached() -> Result<(), String> {
        let cache = DashboardCache::default();
        let key = (Uuid::new_v4(), 28);
        assert!(
            cache
                .get(key, || async { Err("upstream".into()) })
                .await
                .is_err()
        );
        cache.get(key, || async { Ok(data()) }).await?;
        Ok(())
    }

    #[tokio::test]
    async fn stale_data_returns_during_one_background_refresh() -> Result<(), String> {
        let cache = DashboardCache::default();
        let key = (Uuid::new_v4(), 28);
        cache.get(key, || async { Ok(data()) }).await?;
        let slot = Arc::clone(&cache.slots.lock().await.get(&key).ok_or("missing slot")?.1);
        *slot.value.write().await = Some((Instant::now() - FRESH - Duration::from_secs(1), data()));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (finish_tx, finish_rx) = tokio::sync::oneshot::channel();
        cache
            .get(key, || async move {
                let _ = started_tx.send(());
                let _ = finish_rx.await;
                Ok(data())
            })
            .await?;
        started_rx.await.map_err(|e| e.to_string())?;
        cache
            .get(key, || async { Err("duplicate refresh".into()) })
            .await?;
        assert!(slot.refresh.try_lock().is_err());
        let _ = finish_tx.send(());
        let _guard = slot.refresh.lock().await;
        assert!(
            slot.value
                .read()
                .await
                .as_ref()
                .is_some_and(|(at, _)| at.elapsed() < FRESH)
        );
        Ok(())
    }
}
