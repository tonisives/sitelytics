import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
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
  {tab === "overview" && <>{children}{site && <SeoOverview site={site} siteUrl={siteUrl} run={run} busy={busy} />}</>}
  {tab === "ai-visibility" && <AeoSection siteUrl={siteUrl} />}
  {tab !== "overview" && tab !== "ai-visibility" && !site && !error && <p>Loading SEO settings…</p>}
  {site && tab === "settings" && <SettingsForm initial={site.config} save={save} busy={busy} />}
  {site && reportModule(tab) && <ModuleView key={tab} module={reportModule(tab)!} view={tab} site={site} siteUrl={siteUrl} run={run} cancel={cancel} busy={busy} save={save} />}
 </div>
}
let TabLink = ({ value, selected, siteUrl, label }: { value: Tab; selected: Tab; siteUrl: string; label: string }) => <Link aria-current={value === selected ? "page" : undefined} to={`/property/${encodeURIComponent(siteUrl)}${value === "overview" ? "" : `/seo/${value}`}`}>{label}</Link>
let SeoOverview = ({ site, siteUrl, run, busy }: { site: Site; siteUrl: string; run: (module: Module) => Promise<void>; busy: boolean }) => {
 let [collecting, setCollecting] = useState(false)
 let refreshAll = async () => { setCollecting(true); try { for (let module of Object.keys(LABELS) as Module[]) if (site.config.modules[module].enabled && (module !== "rankings" || site.config.keywords.length > 0) && (module !== "research" || !!site.config.product_context.trim()) && !site.jobs.some(job => job.module === module && ACTIVE.includes(job.status))) await run(module) } finally { setCollecting(false) } }
 let reports: [Tab, Module, string][] = [["keywords", "keywords", "Keyword opportunities"], ["rankings", "rankings", "Tracked rankings"], ["competitors", "research", "Competitors"], ["links", "research", "Link opportunities"], ["audit", "audit", "Technical audit"]]
 let metric = (tab: Tab, result: Record<string, unknown>) => tab === "keywords" ? `${rows(result.ideas).length} ideas · ${rows(result.rows).length} GSC queries` : tab === "rankings" ? `${rows(result.tracked).length} tracked terms` : tab === "competitors" ? `${rows(result.competitors).length} checked products · ${rows(result.competitor_candidates).length} to review` : tab === "links" ? `${rows(result.prospects).length} inspected opportunities` : `${text(result.issue_count)} findings · ${text((result.coverage as DataRow)?.visited)} pages checked`
 return <section className={styles.overview}><div className={styles.actions}><h2>SEO opportunities</h2><button type="button" disabled={busy || collecting} onClick={refreshAll}>{collecting ? "Queuing reports…" : "Refresh enabled reports"}</button></div><div className={styles.cards}>{reports.map(([tab, module, label]) => {
  let job = site.jobs.find(job => job.module === module && ["succeeded", "partial"].includes(job.status))
  let enabled = site.config.modules[module].enabled
  return <Link key={tab} className={styles.card} to={`/property/${encodeURIComponent(siteUrl)}/seo/${tab}`}><strong>{label}</strong><span>{!enabled ? "Disabled for this website" : job?.result ? metric(tab, job.result) : "Ready for the first run"}</span><small>{job ? `${date(job.completed_at)}${job.status === "partial" ? " · Partial coverage" : ""}` : "No collected data"}</small><small>{site.config.modules[module].weekly ? "Weekly refresh enabled" : "Manual refresh"}</small></Link>
 })}</div></section>
}
let ResearchInput = ({ config, save, run, active, mode }: { config: Settings; save: (config: Settings) => Promise<void>; run: () => void; active: boolean; mode: "seeds" | "tracked" }) => {
 let initial = (mode === "seeds" ? config.keyword_seeds || [] : config.keywords).join("\n")
 let [value, setValue] = useState(initial)
 let [saving, setSaving] = useState(false)
 let [error, setError] = useState("")
 useEffect(() => { setValue(initial) }, [initial])
 let change = (event: React.ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)
 let submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { let terms = value.split("\n").map(s => s.trim()).filter(Boolean); await save({ ...config, [mode === "seeds" ? "keyword_seeds" : "keywords"]: terms }); run() } catch (error) { setError((error as Error).message) } finally { setSaving(false) } }
 return <form className={styles.researchForm} onSubmit={submit}><label>{mode === "seeds" ? "Topics to research · one per line" : "Keywords to track · one per line"}<textarea rows={3} value={value} onChange={change} placeholder={mode === "seeds" ? "business ideas\nstartup research tools" : "business idea discovery"} /></label><p>{mode === "seeds" ? "Discover Google search suggestions beyond queries that already reach your site. Leave empty to use the product context." : "Compare daily Google average positions over eight weeks. Save ideas from Keyword opportunities to add them here."}</p><button type="submit" disabled={saving || active || (mode === "tracked" && !value.trim())}>{saving ? "Saving…" : mode === "seeds" ? "Research keywords" : "Save and refresh rankings"}</button>{error && <p role="alert">{error}</p>}</form>
}
let SettingsForm = ({ initial, save, busy }: { initial: Settings; save: (settings: Settings) => Promise<void>; busy: boolean }) => {
 let [value, setValue] = useState(initial)
 let [saved, setSaved] = useState(false)
 let submit = async (event: React.FormEvent) => { event.preventDefault(); setSaved(false); try { await save(value); setSaved(true) } catch {} }
 let field = (key: "root_url" | "country" | "language") => (event: React.ChangeEvent<HTMLInputElement>) => { setValue({ ...value, [key]: event.target.value }); setSaved(false) }
 let context = (event: React.ChangeEvent<HTMLTextAreaElement>) => { setValue({ ...value, product_context: event.target.value }); setSaved(false) }
 let list = (key: "keywords" | "keyword_seeds" | "competitors" | "link_candidates" | "render_urls") => (event: React.ChangeEvent<HTMLTextAreaElement>) => { setValue({ ...value, [key]: event.target.value.split("\n") }); setSaved(false) }
 let limit = (event: React.ChangeEvent<HTMLInputElement>) => setValue({ ...value, page_limit: Number(event.target.value) })
 return <form className={styles.settings} onSubmit={submit}>
  <div><h2>SEO settings</h2><p>Choose what to research for this website. Enabling a module does not start a run. Weekly schedules begin in seven days.</p></div>
  <div className={styles.modules}>{(Object.keys(LABELS) as Module[]).map(module => <ModuleToggle key={module} module={module} value={value} change={setValue} />)}</div>
  <label>Website crawl root<input value={value.root_url} onChange={field("root_url")} required type="url" /></label>
  <div className={styles.fields}><label>Requested country<input value={value.country} onChange={field("country")} maxLength={2} required /></label><label>Language<input value={value.language} onChange={field("language")} required /></label><label>Audit page limit<input type="number" min={1} max={500} value={value.page_limit} onChange={limit} /></label></div>
  <p>Desktop SERP samples use the browser’s network location. Country is a search hint; city-level targeting is not available.</p>
  <label>Product context for competitor research<textarea rows={3} maxLength={500} value={value.product_context || ""} onChange={context} placeholder="Business idea discovery and early market signals for founders" /><span>Describe what people use this product for. Research searches and checks this context, rather than the business name.</span></label>
  <label>Keyword research topics · one per line, up to 10<textarea rows={3} value={(value.keyword_seeds || []).join("\n")} onChange={list("keyword_seeds")} placeholder="business ideas\nstartup market research" /><span>Discover new search terms from these topics. Product context is used when this is empty.</span></label>
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
let ModuleView = ({ module, view, site, siteUrl, run, cancel, busy, save }: { module: Module; view: Tab; site: Site; siteUrl: string; run: (module: Module) => Promise<void>; cancel: (id: string) => Promise<void>; busy: boolean; save: (config: Settings) => Promise<void> }) => {
 let jobs = site.jobs.filter(job => job.module === module)
 let active = jobs.find(job => ACTIVE.includes(job.status))
 let [selected, setSelected] = useState("")
 let [historical, setHistorical] = useState<Job | null>(null)
 let [historyError, setHistoryError] = useState("")
 let latest = historical?.id === selected ? historical : jobs.find(job => job.id === selected) || jobs.find(job => ACTIVE.includes(job.status) && !!job.result?.source) || jobs.find(job => ["succeeded", "partial"].includes(job.status))
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
 let schedule = site.schedules?.find(item => item.module === module)
 if (!site.config.modules[module].enabled) return <section className={styles.empty}><h2>{title}</h2><p>This module is disabled for this website. Enable it in SEO settings to start collecting data.</p></section>
 return <section className={styles.module}>
  <div className={styles.actions}><h2>{title}</h2><button type="button" disabled={busy || !!active} onClick={start}>Run now</button>{active && <><span role="status">{active.status === "waiting_browser" ? online ? "Browser research queued or running" : "Waiting for browser worker" : active.status}</span><button type="button" onClick={stop}>Cancel</button></>}</div>
  <p>{schedule ? `Weekly refresh · next run ${date(schedule.next_run_at)}` : "Automatic refresh is off."} <Link to={`/property/${encodeURIComponent(siteUrl)}/seo/settings`}>SEO settings</Link></p>
  {module === "keywords" && <ResearchInput config={site.config} save={save} run={start} active={!!active} mode="seeds" />}
  {module === "rankings" && <ResearchInput config={site.config} save={save} run={start} active={!!active} mode="tracked" />}
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
  {browser && <p>{browser.search_engine ? `${text(browser.search_engine)} · ` : ""}{browser.search_engine === "DuckDuckGo Lite" ? "Searches run from the remote worker; country and language settings are not applied to these searches. Competitor pages are checked with the shared browser." : `Desktop · requested country: ${text(browser.requested_country)} · language: ${text(browser.requested_language)}. Location follows the browser’s network; country selection is a hint.`}</p>}
  <label className={styles.search}>Filter results<input type="search" value={query} onChange={filter} placeholder="Keyword, URL or issue" /></label>
  {job.module === "keywords" && <><KeywordIdeas data={filtered(rows(result.ideas))} config={config} save={save} /><details><summary>Existing Google Search Console queries ({rows(result.rows).length})</summary><p>Impressions and average positions describe this website. Low CTR means at least 100 impressions and CTR below 2%; near-page-one means average position 4–20.</p><KeywordTable data={filtered(rows(result.rows))} config={config} save={save} /></details></>}
  {job.module === "rankings" && <RankReport result={result} data={filtered(rows(result.tracked))} />}
  {job.module === "research" && result.research_version !== 2 && <p>This snapshot used the earlier branded search. Run research again after setting product context to see checked competitors and link prospects.</p>}
  {job.module === "research" && result.research_version === 2 && view === "competitors" && <CompetitorReport data={filtered(rows(result.competitors))} candidates={filtered(rows(result.competitor_candidates))} context={text(result.product_context)} config={config} save={save} />}
  {job.module === "research" && result.research_version === 2 && view === "links" && <ProspectReport data={filtered(rows(result.prospects))} />}
  {job.module === "research" && result.research_version === 2 && view === "competitors" && rows(result.suggestions).length > 0 && <details><summary>Keyword ideas ({rows(result.suggestions).length})</summary><KeywordTable data={filtered(rows(result.suggestions))} config={config} save={save} /></details>}
  {job.module === "audit" && <AuditReport result={result} data={filtered(rows(result.issues))} />}
  {job.module !== "research" && rows(result.snapshots).length > 0 && <details><summary>SERP evidence</summary>{rows(result.snapshots).map(snapshot => <div key={text(snapshot.keyword)}><h3>{text(snapshot.keyword)}</h3><DataTable data={rows(snapshot.entries)} columns={[["position", "Position"], ["title", "Title"], ["url", "URL"], ["snippet", "Observed text"]]} /></div>)}</details>}
  {(job.module !== "research" || result.research_version === 2) && [...rows(result.errors), ...rows(result.render_errors), ...rows(result.performance_errors), ...rows(result.discovery_errors), ...rows(result.history_errors)].length > 0 && <><h3>Incomplete checks</h3><DataTable data={[...rows(result.errors), ...rows(result.render_errors), ...rows(result.performance_errors), ...rows(result.discovery_errors), ...rows(result.history_errors)]} columns={[["url", "URL"], ["keyword", "Keyword"], ["error", "Reason"]]} /></>}
 </div>
}
let CompetitorReport = ({ data, candidates, context, config, save }: { data: DataRow[]; candidates: DataRow[]; context: string; config: Settings; save: (config: Settings) => Promise<void> }) => {
 let chart = data.slice(0, 8).map(row => ({ domain: text(row.domain), appearances: Number(row.appearances) || 0 }))
 return <><p>Products checked against: {context || "the saved product context"}. Bars show how often each domain appeared in the sampled searches.</p>
  {data.length ? <div className={styles.chart} role="img" aria-label="Search result appearances by competitor domain"><ResponsiveContainer width="100%" height={Math.max(180, chart.length * 39)}><BarChart data={chart} layout="vertical" margin={{ left: 12, right: 30 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis dataKey="domain" type="category" width={150} /><Tooltip /><Bar dataKey="appearances" fill="var(--chart-teal)" /></BarChart></ResponsiveContainer></div> : <p>No competitor websites could be confirmed in this sample.</p>}
  <details><summary>Checked competitor pages ({data.length})</summary><div className={styles.competitorList}>{data.map(row => <article key={text(row.domain)}><h4>{text(row.domain)}</h4><p><Cell value={row.page_url} /></p><p>{text(row.description || row.page_title)}</p><small>Matched context: {text(row.matched_terms)} · {text(row.confirmed_by)}</small></article>)}</div></details>
  {!!candidates.length && <details><summary>Candidates to review ({candidates.length})</summary><p>These search results match the context, but the website check was unavailable. Review the product before adding it.</p><div className={styles.competitorList}>{candidates.map(row => <article key={text(row.domain)}><h4>{text(row.domain)}</h4><p><Cell value={row.result_url} /></p><p>{text(row.result_title)}</p><p>{text(row.reason)}</p><SaveCompetitor domain={text(row.domain)} config={config} save={save} /></article>)}</div></details>}
 </>
}
let KeywordIdeas = ({ data, config, save }: { data: DataRow[]; config: Settings; save: (config: Settings) => Promise<void> }) => {
 if (!data.length) return <><h3>New keyword ideas</h3><p>No search suggestions are available in this snapshot. Add research topics above and run keyword research.</p></>
 return <><h3>New keyword ideas ({data.length})</h3><p>Google autocomplete suggestions are based on the research topics. “New” means no matching query in the GSC data collected for this website. Search volume and difficulty are unavailable from this source.</p><div className={styles.table}><table><thead><tr><th>Keyword</th><th>Research topic</th><th>Opportunity</th><th>This site’s impressions</th><th>Track</th></tr></thead><tbody>{data.map(row => <tr key={text(row.keyword)}><td>{text(row.keyword)}</td><td>{text(row.seeds)}</td><td>{text(row.opportunity)}</td><td>{text(row.owned_impressions)}</td><td><SaveKeyword keyword={text(row.keyword)} config={config} save={save} /></td></tr>)}</tbody></table></div></>
}
let RankReport = ({ result, data }: { result: DataRow; data: DataRow[] }) => {
 let availableHistory = rows(result.history)
 let first = data.find(row => availableHistory.some(point => text(point.keyword).toLowerCase() === text(row.keyword).toLowerCase())) || data[0]
 let [selected, setSelected] = useState(text(first?.keyword || ""))
 let keyword = data.some(row => row.keyword === selected) ? selected : text(first?.keyword || "")
 let choose = (event: React.ChangeEvent<HTMLSelectElement>) => setSelected(event.target.value)
 let history = rows(result.history).filter(row => text(row.keyword).toLowerCase() === keyword.toLowerCase())
 let period = result.rank_period as DataRow | undefined
 let daily: DataRow[] = []
 if (period?.start && period?.end) {
  let start = new Date(`${text(period.start)}T00:00:00Z`), end = new Date(`${text(period.end)}T00:00:00Z`)
  for (let timestamp = start.getTime(); timestamp <= end.getTime() && daily.length < 120; timestamp += 86400000) { let date = new Date(timestamp).toISOString().slice(0, 10); let row = history.find(row => row.date === date); daily.push({ date, position: row?.position ?? null }) }
 }
 let display = data.map(row => ({ ...row, position: typeof row.position === "number" ? row.position.toFixed(1) : "No reported impressions", previous_position: typeof row.previous_position === "number" ? row.previous_position.toFixed(1) : "—", position_change: typeof row.position_change === "number" ? `${row.position_change > 0 ? "+" : ""}${row.position_change.toFixed(1)}` : "—" }))
 return <><h3>Google rank history</h3><p>{text(result.rank_note || "Refresh rankings to collect eight weeks of daily Google average positions for the tracked keywords.")}</p>{data.length > 0 && <label className={styles.search}>Chart keyword<select value={keyword} onChange={choose}>{data.map(row => <option key={text(row.keyword)} value={text(row.keyword)}>{text(row.keyword)}</option>)}</select></label>}{!!keyword && history.length === 0 && <p>No daily position was reported for this keyword during the selected period.</p>}{history.length > 0 && <div className={styles.chart} role="img" aria-label={`Daily Google average position for ${keyword}`}><ResponsiveContainer width="100%" height={240}><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={25} /><YAxis reversed domain={[1, "auto"]} /><Tooltip /><Line dataKey="position" name="Average position" stroke="var(--chart-teal)" dot connectNulls={false} /></LineChart></ResponsiveContainer></div>}<DataTable data={display} columns={[["keyword", "Tracked keyword"], ["position", "Last 28 days"], ["previous_position", "Previous 28 days"], ["position_change", "Position improvement"], ["impressions", "Impressions"], ["clicks", "Clicks"], ["status", "Coverage"]]} /><details><summary>Remote Google result samples</summary><p>Samples show organic result order from the remote browser. They depend on location and may be blocked independently of GSC history.</p><DataTable data={rows(result.snapshots)} columns={[["keyword", "Keyword"], ["position", "Observed position"], ["ranking_url", "Ranking URL"], ["observed_depth", "Results observed"], ["status", "Coverage"]]} /></details></>
}
let AuditReport = ({ result, data }: { result: DataRow; data: DataRow[] }) => {
 let [severity, setSeverity] = useState("all")
 let choose = (event: React.ChangeEvent<HTMLSelectElement>) => setSeverity(event.target.value)
 let grouped = new Map<string, DataRow[]>()
 for (let row of data) { if (severity !== "all" && (row.severity || "warning") !== severity) continue; let key = text(row.code); grouped.set(key, [...(grouped.get(key) || []), row]) }
 let priority: Record<string, number> = { error: 0, warning: 1, info: 2 }
 let groups = [...grouped].sort((a,b) => (priority[text(a[1][0].severity || "warning")] ?? 1) - (priority[text(b[1][0].severity || "warning")] ?? 1) || b[1].length - a[1].length)
 return <><h3>Technical findings</h3><p>{text(result.issue_count)} findings · {rows(result.new_issues).length} new · {rows(result.resolved_issues).length} resolved. Resolved findings require a complete crawl.</p><label className={styles.search}>Priority<select value={severity} onChange={choose}><option value="all">All findings</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="info">Checks to review</option></select></label>{!groups.length && <p>No matching findings in the pages checked. Review crawl coverage above before treating the website as fully checked.</p>}{groups.map(([code, affected]) => <details className={styles.issueGroup} key={code}><summary><strong>{code.replaceAll("_", " ")}</strong><span>{text(affected[0].severity || "warning")} · {affected.length} findings</span></summary><p>{text(affected[0].action || "Review the affected pages and confirm the intended behavior.")}</p><DataTable data={affected} columns={[["url", "Affected page"], ["detail", "Finding"]]} /></details>)}{!!rows(result.rendered_pages).length && <details><summary>Rendered page observations ({rows(result.rendered_pages).length})</summary><DataTable data={rows(result.rendered_pages)} columns={[["url", "Page"], ["title", "Title"], ["h1", "H1 headings"], ["canonical", "Canonical"], ["noindex", "Noindex"]]} /></details>}<details><summary>Crawled pages ({rows(result.pages).length})</summary><DataTable data={rows(result.pages)} columns={[["url", "Page"], ["status", "HTTP status"], ["title", "Title"], ["canonical", "Canonical"]]} /></details></>
}
let SaveCompetitor = ({ domain, config, save }: { domain: string; config: Settings; save: (config: Settings) => Promise<void> }) => {
 let [busy, setBusy] = useState(false)
 let saved = config.competitors.includes(domain)
 let click = async () => { setBusy(true); try { await save({ ...config, competitors: [...config.competitors, domain] }) } catch {} finally { setBusy(false) } }
 return <button type="button" disabled={busy || saved || config.competitors.length >= 10} onClick={click}>{saved ? "Saved competitor" : busy ? "Saving…" : "Add competitor"}</button>
}
let ProspectReport = ({ data }: { data: DataRow[] }) => {
 let [limit, setLimit] = useState(25)
 let more = () => setLimit(limit + 50)
 if (!data.length) return <p>No relevant editorial pages or observed links were found in this sample. Add candidate URLs in SEO settings or run research again.</p>
 return <><p>Rows marked “observed link” have a verified link on the inspected page. Topical outreach ideas match the product context but have no verified link to a competitor or this site. This is a sample, not a backlink index.</p><div className={`${styles.table} ${styles.compactTable}`}><table><thead><tr><th>Page</th><th>Type</th><th>Competitor links</th><th>Links to this site</th><th>Evidence</th></tr></thead><tbody>{data.slice(0, limit).map(row => <tr key={text(row.url)}><td><a href={text(row.url)} target="_blank" rel="noopener noreferrer" title={text(row.url)}>{text(row.title || row.url)}</a></td><td>{text(row.status || "observed link")}</td><td>{Array.isArray(row.competitor_links) ? row.competitor_links.length : 0}</td><td>{Array.isArray(row.owned_links) ? row.owned_links.length : 0}</td><td><details><summary>View</summary><p><strong>Page:</strong> <Cell value={row.url} /></p><p><strong>Competitor links:</strong> {text(row.competitor_links)}</p><p><strong>Links to this site:</strong> {text(row.owned_links)}</p><p>{text(row.evidence)}</p></details></td></tr>)}</tbody></table></div>{data.length > limit && <button type="button" onClick={more}>Show more ({data.length - limit} remaining)</button>}</>
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
 return <button type="button" onClick={click} disabled={saved || busy || config.keywords.length >= 100}>{saved ? "Tracking" : busy ? "Saving…" : "Track"}</button>
}
let Cell = ({ value }: { value: unknown }) => typeof value === "string" && /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : <>{text(value).replaceAll("_", " ")}</>
let DataTable = ({ data, columns }: { data: DataRow[]; columns: [string, string][] }) => {
 let [limit, setLimit] = useState(50)
 let more = () => setLimit(limit + 100)
 if (!data.length) return <p>No observations for this section.</p>
 return <><div className={styles.table}><table><thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{data.slice(0, limit).map(row => <tr key={columns.map(([key]) => text(row[key])).join("|")}>{columns.map(([key]) => <td key={key}><Cell value={row[key]} /></td>)}</tr>)}</tbody></table></div>{data.length > limit && <button type="button" onClick={more}>Show more ({data.length - limit} remaining)</button>}</>
}
