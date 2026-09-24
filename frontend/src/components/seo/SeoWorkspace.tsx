import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fetchMe } from "../../lib/api"
import { AeoSection } from "../AeoSection"
import { request, rows, text, date, type Module, type Settings, type Site, type Job, type DataRow } from "./api"
import styles from "./seo.module.css"
let LABELS: Record<Module, string> = { keywords: "Keywords", rankings: "Rankings", research: "Competitors & Links", audit: "Technical Audit" }
let ACTIVE = ["queued", "running", "waiting_browser"]
type Tab = "overview" | "settings" | "ai-visibility" | "keywords" | "rankings" | "competitors" | "links" | "audit"
let tabs: [Tab, string][] = [["overview", "Overview"], ["keywords", "Keywords"], ["rankings", "Rankings"], ["competitors", "Competitors"], ["links", "Link prospects"], ["audit", "Technical Audit"], ["ai-visibility", "AI Visibility"], ["settings", "SEO settings"]]
let reportModule = (tab: Tab): Module | null => tab === "competitors" || tab === "links" ? "research" : tab === "keywords" || tab === "rankings" || tab === "audit" ? tab : null
export let SeoWorkspace = ({ siteUrl, report, children }: { siteUrl: string; report?: string; children: ReactNode }) => {
 let [admin, setAdmin] = useState(false)
 let tab: Tab = tabs.some(([key]) => key === report) ? report as Tab : "overview"
 let [site, setSite] = useState<Site | null>(null)
 let [error, setError] = useState("")
 let [busy, setBusy] = useState(false)
 let refresh = useCallback(async () => { try { setSite(await request<Site>(`site?site_url=${encodeURIComponent(siteUrl)}`)); setError("") } catch (error) { setError((error as Error).message) } }, [siteUrl])
 useEffect(() => { let cancelled = false; fetchMe().then(user => { if (!cancelled) setAdmin(user.is_admin) }).catch(() => {}); return () => { cancelled = true } }, [])
 useEffect(() => { setSite(null); if (admin) void refresh() }, [admin, refresh])
 useEffect(() => { if (!admin) return; let timer = setInterval(() => { void refresh() }, 10000); return () => clearInterval(timer) }, [admin, refresh])
 let save = async (config: Settings) => { setBusy(true); try { await request("site", "PUT", { site_url: siteUrl, config }); await refresh() } catch (error) { setError((error as Error).message); throw error } finally { setBusy(false) } }
 let run = async (module: Module) => { setBusy(true); try { await request("jobs", "POST", { site_url: siteUrl, module }); await refresh() } catch (error) { setError((error as Error).message) } finally { setBusy(false) } }
 let cancel = async (id: string) => { try { await request(`jobs/${id}`, "DELETE"); await refresh() } catch (error) { setError((error as Error).message) } }
 if (!admin) return <>{children}<AeoSection siteUrl={siteUrl} /></>
 return <div className={styles.workspace}>
  <nav className={styles.tabs} aria-label="Website reports">
   {tabs.map(([key, label]) => <TabLink key={key} value={key} selected={tab} siteUrl={siteUrl} label={label} />)}
  </nav>
  {error && <p role="alert" className="error-text">{error}</p>}
  {tab === "overview" && children}
  {tab === "ai-visibility" && <AeoSection siteUrl={siteUrl} />}
  {tab !== "overview" && tab !== "ai-visibility" && !site && !error && <p>Loading SEO settings…</p>}
  {site && tab === "settings" && <SettingsForm initial={site.config} save={save} busy={busy} />}
  {site && reportModule(tab) && <ModuleView key={tab} module={reportModule(tab)!} view={tab} site={site} run={run} cancel={cancel} busy={busy} save={save} />}
 </div>
}
let TabLink = ({ value, selected, siteUrl, label }: { value: Tab; selected: Tab; siteUrl: string; label: string }) => <Link aria-current={value === selected ? "page" : undefined} to={`/property/${encodeURIComponent(siteUrl)}${value === "overview" ? "" : `/seo/${value}`}`}>{label}</Link>
let SettingsForm = ({ initial, save, busy }: { initial: Settings; save: (settings: Settings) => Promise<void>; busy: boolean }) => {
 let [value, setValue] = useState(initial)
 let [saved, setSaved] = useState(false)
 let submit = async (event: React.FormEvent) => { event.preventDefault(); setSaved(false); try { await save(value); setSaved(true) } catch {} }
 let field = (key: "root_url" | "country" | "language") => (event: React.ChangeEvent<HTMLInputElement>) => { setValue({ ...value, [key]: event.target.value }); setSaved(false) }
 let context = (event: React.ChangeEvent<HTMLTextAreaElement>) => { setValue({ ...value, product_context: event.target.value }); setSaved(false) }
 let list = (key: "keywords" | "competitors" | "link_candidates" | "render_urls") => (event: React.ChangeEvent<HTMLTextAreaElement>) => { setValue({ ...value, [key]: event.target.value.split("\n") }); setSaved(false) }
 let limit = (event: React.ChangeEvent<HTMLInputElement>) => setValue({ ...value, page_limit: Number(event.target.value) })
 return <form className={styles.settings} onSubmit={submit}>
  <div><h2>SEO settings</h2><p>Choose what to research for this website. Enabling a module does not start a run. Weekly schedules begin in seven days.</p></div>
  <div className={styles.modules}>{(Object.keys(LABELS) as Module[]).map(module => <ModuleToggle key={module} module={module} value={value} change={setValue} />)}</div>
  <label>Website crawl root<input value={value.root_url} onChange={field("root_url")} required type="url" /></label>
  <div className={styles.fields}><label>Requested country<input value={value.country} onChange={field("country")} maxLength={2} required /></label><label>Language<input value={value.language} onChange={field("language")} required /></label><label>Audit page limit<input type="number" min={1} max={500} value={value.page_limit} onChange={limit} /></label></div>
  <p>Desktop SERP samples use the browser’s network location. Country is a search hint; city-level targeting is not available.</p>
  <label>Product context for competitor research<textarea rows={3} maxLength={500} value={value.product_context || ""} onChange={context} placeholder="Business idea discovery and early market signals for founders" /><span>Describe what people use this product for. Research searches and checks this context, rather than the business name.</span></label>
  <div className={styles.fields}><label>Saved keywords · one per line, up to 100<textarea rows={7} value={value.keywords.join("\n")} onChange={list("keywords")} placeholder="Start with up to 25 keywords" /></label><label>Known competitor domains · up to 10<textarea rows={7} value={value.competitors.join("\n")} onChange={list("competitors")} placeholder="competitor.com" /></label></div>
  <div className={styles.fields}><label>Link candidate URLs · up to 25<textarea rows={4} value={value.link_candidates.join("\n")} onChange={list("link_candidates")} placeholder="https://example.com/resources" /></label><label>Pages to inspect with JavaScript · up to 5<textarea rows={4} value={value.render_urls.join("\n")} onChange={list("render_urls")} /></label></div>
  <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>{saved && <span role="status">Settings saved.</span>}</div>
 </form>
}
let ModuleToggle = ({ module, value, change }: { module: Module; value: Settings; change: (config: Settings) => void }) => {
 let settings = value.modules[module]
 let enabled = (event: React.ChangeEvent<HTMLInputElement>) => change({ ...value, modules: { ...value.modules, [module]: { ...settings, enabled: event.target.checked } } })
 let weekly = (event: React.ChangeEvent<HTMLInputElement>) => change({ ...value, modules: { ...value.modules, [module]: { ...settings, weekly: event.target.checked } } })
 return <fieldset><legend>{LABELS[module]}</legend><label><input type="checkbox" checked={settings.enabled} onChange={enabled} />Enabled</label><label><input type="checkbox" checked={settings.weekly} disabled={!settings.enabled} onChange={weekly} />Run weekly</label></fieldset>
}
let ModuleView = ({ module, view, site, run, cancel, busy, save }: { module: Module; view: Tab; site: Site; run: (module: Module) => Promise<void>; cancel: (id: string) => Promise<void>; busy: boolean; save: (config: Settings) => Promise<void> }) => {
 let jobs = site.jobs.filter(job => job.module === module)
 let active = jobs.find(job => ACTIVE.includes(job.status))
 let [selected, setSelected] = useState("")
 let [historical, setHistorical] = useState<Job | null>(null)
 let [historyError, setHistoryError] = useState("")
 let latest = historical?.id === selected ? historical : jobs.find(job => job.id === selected) || jobs.find(job => ["succeeded", "partial"].includes(job.status))
 useEffect(() => {
  if (!selected) return
  let cancelled = false
  setHistoryError("")
  request<Job>(`jobs/${selected}`).then(job => { if (!cancelled) setHistorical(job) }).catch(error => { if (!cancelled) setHistoryError(error.message) })
  return () => { cancelled = true }
 }, [selected])
 let start = () => { void run(module) }
 let stop = () => { if (active) void cancel(active.id) }
 let choose = (event: React.ChangeEvent<HTMLSelectElement>) => setSelected(event.target.value)
 let browser = site.workers?.find(worker => worker.worker === "chrome-queue")
 let online = browser && Date.now() - Date.parse(browser.heartbeat_at) < 120000
 let title = view === "competitors" ? "Competitors" : view === "links" ? "Link prospects" : LABELS[module]
 if (!site.config.modules[module].enabled) return <section className={styles.empty}><h2>{title}</h2><p>This module is disabled for this website. Enable it in SEO settings to start collecting data.</p></section>
 return <section className={styles.module}>
  <div className={styles.actions}><h2>{title}</h2><button type="button" disabled={busy || !!active} onClick={start}>Run now</button>{active && <><span role="status">{active.status === "waiting_browser" ? online ? "Browser research queued or running" : "Waiting for browser worker" : active.status}</span><button type="button" onClick={stop}>Cancel</button></>}</div>
  {jobs[0]?.error && <p className="error-text">Last run: {jobs[0].error}</p>}
  {jobs.length > 0 && <label className={styles.history}>Run history<select value={latest?.id || ""} onChange={choose}><option value="">Latest available result</option>{jobs.map(job => <option value={job.id} key={job.id}>{date(job.created_at)} · {job.status}</option>)}</select></label>}
  {historyError && <p className="error-text">{historyError}</p>}
  {!latest && <p>No results yet. Run this module to collect its first snapshot.</p>}
  {latest && <Results key={`${latest.id}:${view}`} job={latest} view={view} config={site.config} save={save} />}
 </section>
}
let Results = ({ job, view, config, save }: { job: Job; view: Tab; config: Settings; save: (config: Settings) => Promise<void> }) => {
 let result = job.result || {}
 let [query, setQuery] = useState("")
 let filter = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value.toLowerCase())
 let period = result.period as Record<string, unknown> | undefined
 let coverage = result.coverage as Record<string, unknown> | undefined
 let browser = result.browser_context as Record<string, unknown> | undefined
 let filtered = (data: DataRow[]) => data.filter(row => !query || JSON.stringify(row).toLowerCase().includes(query))
 return <div className={styles.results}>
  <p className={styles.meta}>{text(result.source || "Browser observation")} · {date(result.collected_at || job.completed_at)} · {job.status === "partial" ? "Partial coverage" : job.status}</p>
  {job.error && <p className="error-text">{job.error}</p>}
  {period && <p>{text(period.start)} to {text(period.end)}, compared with {text(period.previous_start)} to {text(period.previous_end)}.</p>}
  {coverage && <p>{coverage.visited != null ? `${text(coverage.visited)} pages checked · limit ${text(coverage.page_limit)} · ${text(coverage.remaining)} URLs remaining.` : text(coverage.note)}{coverage.capped === true ? " Collection limit reached; some queries may be missing." : ""}</p>}
  {browser && <p>{browser.search_engine ? `${text(browser.search_engine)} · ` : ""}Desktop · requested country: {text(browser.requested_country)} · language: {text(browser.requested_language)}. {browser.search_engine === "Bing" ? "Research results follow the browser’s network location; country and language settings are not applied to these searches." : "Location follows the browser’s network; country selection is a hint."}</p>}
  <label className={styles.search}>Filter results<input type="search" value={query} onChange={filter} placeholder="Keyword, URL or issue" /></label>
  {job.module === "keywords" && <><p>These impressions and average positions describe your site in GSC. Low CTR means at least 100 impressions and CTR below 2%; near-page-one means average position 4–20.</p><KeywordTable data={filtered(rows(result.rows))} config={config} save={save} /></>}
  {job.module === "rankings" && <><p>Positions are observed organic result order. “Not found” means absent from the results collected, not absent from Google.</p><DataTable data={filtered(rows(result.snapshots))} columns={[["keyword", "Keyword"], ["position", "Observed position"], ["ranking_url", "Ranking URL"], ["observed_depth", "Results observed"], ["status", "Coverage"]]} /></>}
  {job.module === "research" && result.research_version !== 2 && <p>This snapshot used the earlier branded search. Run research again after setting product context to see checked competitors and link prospects.</p>}
  {job.module === "research" && result.research_version === 2 && view === "competitors" && <CompetitorReport data={filtered(rows(result.competitors))} context={text(result.product_context)} />}
  {job.module === "research" && result.research_version === 2 && view === "links" && <ProspectReport data={filtered(rows(result.prospects))} />}
  {job.module === "research" && result.research_version === 2 && view === "competitors" && rows(result.suggestions).length > 0 && <details><summary>Keyword ideas ({rows(result.suggestions).length})</summary><KeywordTable data={filtered(rows(result.suggestions))} config={config} save={save} /></details>}
  {job.module === "audit" && <><p>{text(result.issue_count)} findings · {rows(result.new_issues).length} new · {rows(result.resolved_issues).length} resolved. Resolved issues are reported only after a complete crawl.</p><DataTable data={filtered(rows(result.issues))} columns={[["code", "Issue"], ["url", "Affected page"], ["detail", "Details"]]} /><h3>Rendered page observations</h3><DataTable data={filtered(rows(result.rendered_pages))} columns={[["url", "Page"], ["title", "Title"], ["h1", "H1 headings"], ["canonical", "Canonical"], ["noindex", "Noindex"]]} /><details><summary>Crawled pages ({rows(result.pages).length})</summary><DataTable data={filtered(rows(result.pages))} columns={[["url", "Page"], ["status", "HTTP status"], ["title", "Title"], ["canonical", "Canonical"]]} /></details></>}
  {job.module !== "research" && rows(result.snapshots).length > 0 && <details><summary>SERP evidence</summary>{rows(result.snapshots).map(snapshot => <div key={text(snapshot.keyword)}><h3>{text(snapshot.keyword)}</h3><DataTable data={rows(snapshot.entries)} columns={[["position", "Position"], ["title", "Title"], ["url", "URL"], ["snippet", "Observed text"]]} /></div>)}</details>}
  {(job.module !== "research" || result.research_version === 2) && [...rows(result.errors), ...rows(result.render_errors)].length > 0 && <><h3>Incomplete checks</h3><DataTable data={[...rows(result.errors), ...rows(result.render_errors)]} columns={[["url", "URL"], ["keyword", "Keyword"], ["error", "Reason"]]} /></>}
 </div>
}
let CompetitorReport = ({ data, context }: { data: DataRow[]; context: string }) => {
 let chart = data.slice(0, 8).map(row => ({ domain: text(row.domain), appearances: Number(row.appearances) || 0 }))
 if (!data.length) return <p>No context checked competitors in this snapshot. Set product context in SEO settings and run research again.</p>
 return <><p>Products checked against: {context || "the saved product context"}. Bars show how often each domain appeared in the sampled searches, not estimated traffic.</p>
  <div className={styles.chart} role="img" aria-label="Search result appearances by competitor domain"><ResponsiveContainer width="100%" height={Math.max(180, chart.length * 39)}><BarChart data={chart} layout="vertical" margin={{ left: 12, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis dataKey="domain" type="category" width={150} /><Tooltip /><Bar dataKey="appearances" fill="var(--chart-teal)" /></BarChart></ResponsiveContainer></div>
  <details><summary>Checked competitor pages ({data.length})</summary><div className={styles.competitorList}>{data.map(row => <article key={text(row.domain)}><h4>{text(row.domain)}</h4><p><Cell value={row.page_url} /></p><p>{text(row.description || row.page_title)}</p><small>Matched context: {text(row.matched_terms)} · {text(row.confirmed_by)}</small></article>)}</div></details>
 </>
}
let ProspectReport = ({ data }: { data: DataRow[] }) => {
 let [limit, setLimit] = useState(25)
 let more = () => setLimit(limit + 50)
 if (!data.length) return <p>No pages linking to confirmed competitors were observed. Add candidate URLs in SEO settings or run research again.</p>
 return <><p>These inspected pages link to a confirmed competitor or to this website. They are sampled opportunities, not a complete backlink index.</p><div className={`${styles.table} ${styles.compactTable}`}><table><thead><tr><th>Page</th><th>Competitor links</th><th>Links to this site</th><th>Evidence</th></tr></thead><tbody>{data.slice(0, limit).map(row => <tr key={text(row.url)}><td><a href={text(row.url)} target="_blank" rel="noopener noreferrer" title={text(row.url)}>{text(row.title || row.url)}</a></td><td>{Array.isArray(row.competitor_links) ? row.competitor_links.length : 0}</td><td>{Array.isArray(row.owned_links) ? row.owned_links.length : 0}</td><td><details><summary>View</summary><p><strong>Page:</strong> <Cell value={row.url} /></p><p><strong>Competitor links:</strong> {text(row.competitor_links)}</p><p><strong>Links to this site:</strong> {text(row.owned_links)}</p><p>{text(row.evidence)}</p></details></td></tr>)}</tbody></table></div>{data.length > limit && <button type="button" onClick={more}>Show more ({data.length - limit} remaining)</button>}</>
}
let KeywordTable = ({ data, config, save }: { data: DataRow[]; config: Settings; save: (config: Settings) => Promise<void> }) => {
 let [limit, setLimit] = useState(50)
 let more = () => setLimit(limit + 100)
 return <><div className={styles.table}><table><thead><tr><th>Keyword</th><th>Landing page / seed</th><th>Impressions</th><th>Clicks</th><th>Change</th><th>Avg position</th><th>Signals</th><th>Save</th></tr></thead><tbody>{data.slice(0, limit).map(row => <tr key={`${text(row.keyword)}:${text(row.page || row.seed)}`}><td>{text(row.keyword)}</td><td><Cell value={row.page || row.seed} /></td><td>{text(row.impressions)}</td><td>{text(row.clicks)}</td><td>{text(row.click_delta)}</td><td>{typeof row.position === "number" ? row.position.toFixed(1) : "—"}</td><td>{text(row.signals).replaceAll("_", " ")}</td><td><SaveKeyword keyword={text(row.keyword)} config={config} save={save} /></td></tr>)}</tbody></table></div>{!data.length && <p>No matching keywords in this snapshot.</p>}{data.length > limit && <button type="button" onClick={more}>Show more ({data.length - limit} remaining)</button>}</>
}
let SaveKeyword = ({ keyword, config, save }: { keyword: string; config: Settings; save: (config: Settings) => Promise<void> }) => {
 let [busy, setBusy] = useState(false)
 let saved = config.keywords.includes(keyword)
 let click = async () => { setBusy(true); try { await save({ ...config, keywords: [...config.keywords, keyword] }) } catch {} finally { setBusy(false) } }
 return <button type="button" onClick={click} disabled={saved || busy || config.keywords.length >= 100}>{saved ? "Saved" : busy ? "Saving…" : "Save"}</button>
}
let Cell = ({ value }: { value: unknown }) => typeof value === "string" && /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : <>{text(value).replaceAll("_", " ")}</>
let DataTable = ({ data, columns }: { data: DataRow[]; columns: [string, string][] }) => {
 let [limit, setLimit] = useState(50)
 let more = () => setLimit(limit + 100)
 if (!data.length) return <p>No observations for this section.</p>
 return <><div className={styles.table}><table><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{data.slice(0, limit).map(row => <tr key={columns.map(([key]) => text(row[key])).join("|")}>{columns.map(([key]) => <td key={key}><Cell value={row[key]} /></td>)}</tr>)}</tbody></table></div>{data.length > limit && <button type="button" onClick={more}>Show more ({data.length - limit} remaining)</button>}</>
}
