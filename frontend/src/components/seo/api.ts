export type Module = "keywords" | "rankings" | "research" | "audit"
export type Settings = {
 root_url: string; modules: Record<Module, { enabled: boolean; weekly: boolean }>
 keywords: string[]; competitors: string[]; product_context: string; link_candidates: string[]; render_urls: string[]
 country: string; language: string; page_limit: number
}
export type DataRow = Record<string, unknown>
export type Job = { id: string; module: Module; status: string; created_at: string; completed_at?: string; error?: string; result?: Record<string, unknown> }
export type Worker = { worker: string; heartbeat_at: string; detail: Record<string, unknown>; backlog?: number; oldest_pending?: string; last_success?: string; failures_24h?: number }
export type Site = { config: Settings; jobs: Job[]; workers?: Worker[] }
export type Summary = { site_url: string; keywords: number; issues: number | null; last_success: string | null; enabled: Settings["modules"] }
export let request = async <T,>(path: string, method = "GET", body?: unknown): Promise<T> => {
 let response = await fetch(`/api/seo/${path}`, { method, credentials: "include", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
 if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`)
 return response.json()
}
export let rows = (value: unknown): DataRow[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object") : []
export let text = (value: unknown): string => value == null ? "—" : Array.isArray(value) ? value.map(text).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value)
export let date = (value: unknown) => typeof value === "string" ? new Date(value).toLocaleString() : "—"
