import { useEffect, useMemo, useState } from "react"
import type { ChangeEvent } from "react"
import type { AeoCadence, AeoProperty, AeoQuery, AeoQueryKind, AeoResult, AeoVisibilityLevel } from "../types"
import { createAeoQuery, deleteAeoQuery, fetchAeoProperty, fetchAeoQueries, fetchAeoResults, saveAeoProperty, updateAeoQuery } from "../lib/api"

let PROVIDERS = ["chatgpt", "perplexity", "claude"]
let LEVEL_SCORE: Record<AeoVisibilityLevel,number> = {absent:0,cited:1,mentioned:2,recommended:3,top_pick:4}
let LEVELS: AeoVisibilityLevel[] = ["absent","cited","mentioned","recommended","top_pick"]

export let AeoSection = ({siteUrl}:{siteUrl:string}) => {
  let [property,setProperty] = useState<AeoProperty|null>(null)
  let [queries,setQueries] = useState<AeoQuery[]>([])
  let [results,setResults] = useState<AeoResult[]>([])
  let [brand,setBrand] = useState("")
  let [domain,setDomain] = useState(() => siteUrl.replace(/^https?:\/\//,"").replace(/\/$/,""))
  let [aliases,setAliases] = useState("")
  let [prompt,setPrompt] = useState("")
  let [cadence,setCadence] = useState<AeoCadence>("weekly")
  let [kind,setKind] = useState<AeoQueryKind>("discovery")
  let [kindOverridden,setKindOverridden] = useState(false)
  let [error,setError] = useState<string|null>(null)

  let reload = async () => {
    let [propertyResult,queryResult,resultRows] = await Promise.all([
      fetchAeoProperty(siteUrl).catch(() => null),fetchAeoQueries(siteUrl),fetchAeoResults(siteUrl),
    ])
    setProperty(propertyResult); setQueries(queryResult); setResults(resultRows)
    if (propertyResult) { setBrand(propertyResult.brand_name);setDomain(propertyResult.owned_domain);setAliases(propertyResult.aliases.filter((v) => v !== propertyResult.brand_name).join(", ")) }
  }
  useEffect(() => { reload().catch((value) => setError(value.message)) },[siteUrl])

  let saveProperty = async () => {
    try { let value=await saveAeoProperty({site_url:siteUrl,brand_name:brand,owned_domain:domain,aliases:aliases.split(",").map((v)=>v.trim()).filter(Boolean)});setProperty(value);setError(null) }
    catch(value:any){setError(value.message)}
  }
  let addQuery = async () => {
    try { await createAeoQuery({site_url:siteUrl,prompt,cadence,kind});setPrompt("");setKind("discovery");setKindOverridden(false);await reload();setError(null) }
    catch(value:any){setError(value.message)}
  }
  let toggleQuery = async (query:AeoQuery) => { await updateAeoQuery(query.id,{active:!query.active});await reload() }
  let removeQuery = async (id:string) => { await deleteAeoQuery(id);await reload() }
  let saveQuery = async (id:string,value:Partial<Pick<AeoQuery,"prompt"|"cadence"|"kind">>) => { await updateAeoQuery(id,value);await reload() }
  let handlePromptChange = (event:ChangeEvent<HTMLInputElement>) => {
    let value=event.target.value
    setPrompt(value)
    if (!kindOverridden) {
      let knownAliases=[brand,...aliases.split(",")].map((alias)=>alias.trim().toLocaleLowerCase()).filter(Boolean)
      setKind(knownAliases.some((alias)=>value.toLocaleLowerCase().includes(alias))?"branded":"discovery")
    }
  }
  let handleKindChange = (event:ChangeEvent<HTMLSelectElement>) => { setKind(event.target.value as AeoQueryKind);setKindOverridden(true) }

  return <section className="aeo-card">
    <div className="aeo-heading"><div><h2>AI visibility beta</h2><p>Three independent samples per provider. Missing coverage is shown as unknown.</p></div><span className="beta-badge">Free beta</span></div>
    <div className="aeo-config-grid">
      <label>Brand name<input value={brand} onChange={(event)=>setBrand(event.target.value)} placeholder="Trend Seeker" /></label>
      <label>Owned domain<input value={domain} onChange={(event)=>setDomain(event.target.value)} placeholder="trend-seeker.app" /></label>
      <label>Aliases<input value={aliases} onChange={(event)=>setAliases(event.target.value)} placeholder="TSKR, TrendSeeker" /></label>
      <button className="primary-btn" onClick={saveProperty}>Save brand</button>
    </div>
    {property && <div className="aeo-query-form">
      <label className="query-prompt">Query<input value={prompt} onChange={handlePromptChange} placeholder="What are the best tools for finding emerging business trends?" /></label>
      <label>Type<select value={kind} onChange={handleKindChange}><option value="discovery">Discovery</option><option value="branded">Branded</option></select></label>
      <label>Cadence<select value={cadence} onChange={(event)=>setCadence(event.target.value as AeoCadence)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      <button className="primary-btn" onClick={addQuery} disabled={!prompt.trim()}>Add query</button>
    </div>}
    {error && <p className="error-text">{error}</p>}
    {queries.map((query)=><QueryResult key={query.id} query={query} rows={results.filter((row)=>row.query_id===query.id)} toggle={()=>toggleQuery(query)} remove={()=>removeQuery(query.id)} save={(value)=>saveQuery(query.id,value)} />)}
    {!property && <p className="empty-copy">Save the brand configuration to add up to ten recurring queries.</p>}
  </section>
}

let QueryResult = ({query,rows,toggle,remove,save}:{query:AeoQuery;rows:AeoResult[];toggle:()=>void;remove:()=>void;save:(value:Partial<Pick<AeoQuery,"prompt"|"cadence"|"kind">>)=>Promise<void>}) => {
  let [editing,setEditing]=useState(false)
  let [draftPrompt,setDraftPrompt]=useState(query.prompt)
  let [draftKind,setDraftKind]=useState(query.kind)
  let [draftCadence,setDraftCadence]=useState(query.cadence)
  let latestRun = rows.find((row)=>row.run_id)?.run_id
  let latest = rows.filter((row)=>row.run_id===latestRun)
  let saveDraft=async()=>{await save({prompt:draftPrompt,kind:draftKind,cadence:draftCadence});setEditing(false)}
  return <div className={`aeo-query${query.active?"":" query-paused"}`}>
    {editing?<div className="query-edit-row"><input value={draftPrompt} onChange={(event)=>setDraftPrompt(event.target.value)}/><select value={draftKind} onChange={(event)=>setDraftKind(event.target.value as AeoQueryKind)}><option value="discovery">Discovery</option><option value="branded">Branded</option></select><select value={draftCadence} onChange={(event)=>setDraftCadence(event.target.value as AeoCadence)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><button className="primary-btn" onClick={saveDraft}>Save</button><button className="text-btn" onClick={()=>setEditing(false)}>Cancel</button></div>:<div className="aeo-query-title"><div><strong>{query.prompt}</strong><span>{query.kind} · {query.cadence}</span></div><div><button className="text-btn" onClick={()=>setEditing(true)}>Edit</button><button className="text-btn" onClick={toggle}>{query.active?"Pause":"Resume"}</button><button className="text-btn danger" onClick={remove}>Delete</button></div></div>}
    <div className="provider-grid">{PROVIDERS.map((provider)=><ProviderResult key={provider} provider={provider} rows={latest.filter((row)=>row.provider===provider)} />)}</div>
    <RunHistory rows={rows.filter((row)=>row.run_id&&row.run_id!==latestRun)} />
  </div>
}

let ProviderResult = ({provider,rows}:{provider:string;rows:AeoResult[]}) => {
  let successful=rows.filter((row)=>row.status==="succeeded"&&row.level)
  let known=successful.length>=2
  let values=successful.map((row)=>LEVEL_SCORE[row.level as AeoVisibilityLevel]).sort((a,b)=>a-b)
  let level=known?LEVELS[values[Math.floor(values.length/2)]]:null
  let ranks=successful.map((row)=>row.rank).filter((rank):rank is number=>typeof rank==="number").sort((a,b)=>a-b)
  let rank=known&&ranks.length?ranks[Math.floor(ranks.length/2)]:null
  let evidence=successful.find((row)=>row.evidence)?.evidence
  let citations=useMemo(()=>[...new Set(successful.flatMap((row)=>row.citations||[]))],[rows])
  let competitors=[...new Set(successful.flatMap((row)=>row.competitors||[]))].slice(0,4)
  return <div className="provider-result"><div className="provider-name">{provider}</div><div className={`visibility-level level-${level||"unknown"}`}>{level?.replace("_"," ")||"unknown"}{rank?` · #${rank}`:""}</div><div className="coverage">{successful.length}/3 samples</div>{evidence&&<p>{evidence}</p>}{competitors.length>0&&<p>Also named: {competitors.join(", ")}</p>}{citations.length>0&&<a href={citations[0]} target="_blank" rel="noopener">{citations.length} source citation{citations.length===1?"":"s"}</a>}</div>
}

let RunHistory = ({rows}:{rows:AeoResult[]}) => {
  let runs=useMemo(()=>{
    let grouped=new Map<string,AeoResult[]>()
    for(let row of rows){if(row.run_id)grouped.set(row.run_id,[...(grouped.get(row.run_id)||[]),row])}
    return [...grouped.values()].slice(0,5)
  },[rows])
  if(!runs.length)return null
  return <details className="aeo-history"><summary>History ({runs.length} prior refresh{runs.length===1?"":"es"})</summary>{runs.map((run)=><div className="history-row" key={run[0].run_id}><time>{run[0].scheduled_for?new Date(run[0].scheduled_for).toLocaleDateString():"Earlier"}</time>{PROVIDERS.map((provider)=>{let samples=run.filter((row)=>row.provider===provider&&row.status==="succeeded"&&row.level);let levels=samples.map((row)=>LEVEL_SCORE[row.level as AeoVisibilityLevel]).sort((a,b)=>a-b);let level=samples.length>=2?LEVELS[levels[Math.floor(levels.length/2)]]:"unknown";return <span key={provider}>{provider}: {level.replace("_"," ")} ({samples.length}/3)</span>})}</div>)}</details>
}
