import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { request, date, type Summary, type Worker } from "./api"
import styles from "./seo.module.css"
let SummaryContext = createContext<Record<string, Summary>>({})
export let SeoSummaryProvider = ({ children }: { children: ReactNode }) => {
 let [summary, setSummary] = useState<Record<string, Summary>>({})
 useEffect(() => { let cancelled = false; request<Summary[]>("summary").then(rows => { if (!cancelled) setSummary(Object.fromEntries(rows.map(row => [row.site_url, row]))) }).catch(() => {}); return () => { cancelled = true } }, [])
 return <SummaryContext.Provider value={summary}>{children}</SummaryContext.Provider>
}
export let SeoSummary = ({ siteUrl }: { siteUrl: string }) => {
 let summary = useContext(SummaryContext)[siteUrl]
 if (!summary || !Object.values(summary.enabled).some(module => module.enabled)) return null
 let details = `${summary.enabled.audit.enabled ? `${summary.issues ?? "—"} audit findings · ` : ""}${summary.enabled.rankings.enabled ? `${summary.keywords} tracked keywords · ` : ""}${summary.last_success ? `Updated ${new Date(summary.last_success).toLocaleDateString()}` : "Awaiting first run"}`
 return <small className={styles.summary} title={`${details} · Last successful SEO run: ${date(summary.last_success)}`}>{details}</small>
}
export let SeoHealth = () => {
 let [workers, setWorkers] = useState<Worker[]>([])
 useEffect(() => { let load = () => request<Worker[]>("health").then(setWorkers).catch(() => {}); void load(); let timer = setInterval(load, 30000); return () => clearInterval(timer) }, [])
 return <section><h2>SEO workers</h2>{workers.length ? workers.map(worker => <p key={worker.worker}>{worker.worker}: {Date.now() - Date.parse(worker.heartbeat_at) < 120000 ? "online" : "stale"} · heartbeat {date(worker.heartbeat_at)} · {worker.backlog ?? 0} pending · oldest {date(worker.oldest_pending)} · last success {date(worker.last_success)} · {worker.failures_24h ?? 0} failures today</p>) : <p>No worker heartbeat yet.</p>}</section>
}
