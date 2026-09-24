import { Kafka, logLevel } from "kafkajs"
import { randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { extractBingSerp, extractSerp, extractPage, rankResult } from "./extract.mjs"
import { candidateInspectionUrl, competitorCandidates, researchQueries, validateCompetitor } from "./research.mjs"
let brokers = process.env.KAFKA_BROKERS?.split(",")
let base = process.env.SITELYTICS_URL
let token = process.env.SEO_BROWSER_TOKEN
if (!brokers?.length || !base || !token) throw new Error("KAFKA_BROKERS, SITELYTICS_URL and SEO_BROWSER_TOKEN are required")
let kafka = new Kafka({ clientId: "sitelytics-seo-browser", brokers, logLevel: logLevel.ERROR })
let producer = kafka.producer()
let consumer = kafka.consumer({ groupId: "sitelytics-seo-browser-v2", sessionTimeout: 60000 })
let scrapeConsumer = kafka.consumer({ groupId: "sitelytics-seo-scrape-results-v1" })
let responseTopic = "sitelytics.seo.browser.responses"
let scrapeRequests = "tskr.scrape.headless.requests"
let scrapeResponses = "tskr.scrape.responses"
let pending = new Map()
let sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let scrape = async (job, url) => {
 let requestId = `sitelytics-seo:${job.id}:${randomUUID()}`
 let response = new Promise((resolve, reject) => {
  let timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Chrome queue response timed out")) }, 600000)
  pending.set(requestId, value => { clearTimeout(timer); pending.delete(requestId); resolve(value) })
 })
 let request = {
  schema_version: 1, request_id: requestId, lane: "headless", domain_key: url.hostname,
  service_class: "batch", network: {}, retry: { max_attempts: 1, initial_delay_ms: 5000, max_delay_ms: 300000 },
  attempt: 1, url: url.href, output_format: "html", headers: {}, timeout_ms: 60000,
  wait_after_load_ms: 1500, max_content_bytes: 1048576,
  callback: { kind: "sitelytics.seo", data: { job_id: job.id } }, enqueued_at: new Date().toISOString()
 }
 try { await producer.send({ topic: scrapeRequests, messages: [{ key: requestId, value: JSON.stringify(request) }] }) }
 catch (error) { pending.get(requestId)?.({ status: "failed", error: { message: error.message } }); throw error }
 let value = await response
 if (value.status !== "succeeded") throw new Error(value.error?.message || "Chrome scrape failed")
 if (value.content_truncated || !value.content || !value.final_url) throw new Error("Chrome scrape returned incomplete HTML")
 await publicUrl(value.final_url)
 return { html: value.content, url: value.final_url }
}
let isPublic = address => {
 if (isIP(address) === 6) return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(0*:|db8:|[01][0-9a-f]{0,2}:)/i.test(address) && !/^2002:/i.test(address)
 let [a,b] = address.split(".").map(Number)
 return isIP(address) === 4 && a > 0 && a < 224 && a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19))
}
let publicUrl = async value => {
 let url = new URL(value)
 if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("Unsupported URL")
 let ips = await lookup(url.hostname, { all: true })
 if (!ips.length || ips.some(({ address }) => !isPublic(address))) throw new Error("Non-public destination")
 return url
}
let authorized = async id => {
 let response = await fetch(`${base}/api/seo/browser/jobs/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
 if (!response.ok) throw new Error("Could not verify browser job authorization")
 return (await response.json()).active === true
}
let send = value => producer.send({ topic: responseTopic, messages: [{ key: value.id || "heartbeat", value: JSON.stringify(value) }] })
let lastGoogle = 0
let processJob = async (job, heartbeat) => {
 if (job.version !== 1 || !["rankings", "research", "audit"].includes(job.kind) || !/^[a-f0-9-]{36}$/.test(job.id)) throw new Error("Unsupported browser job")
 if (Date.parse(job.expires_at) < Date.now() || !(await authorized(job.id))) return
 let root = await publicUrl(job.config.root_url)
 let result = { source: "shared Chrome queue observation", collected_at: new Date().toISOString(), browser_context: { device: "desktop", requested_country: job.config.country, requested_language: job.config.language, location_precision: "Browser IP region; requested country is a hint, not verified geolocation" }, snapshots: [], pages: [], prospects: [], suggestions: [], errors: [] }
 let navigate = async address => {
  if (!(await authorized(job.id))) throw new Error("Job cancelled")
  await heartbeat()
  let url = await publicUrl(address)
  if (url.hostname === "www.google.com") { await sleep(Math.max(0, 10000 - (Date.now() - lastGoogle))); lastGoogle = Date.now() }
  return scrape(job, url)
 }
 {
  let context = (job.config.product_context || "").trim()
  let knownCompetitors = (job.config.competitors || []).map(domain => domain.replace(/^www\./, ""))
  if (job.kind === "research") { result.research_version = 2; result.product_context = context; result.browser_context.search_engine = "Bing" }
  let queries = job.kind === "rankings" ? job.config.keywords.slice(0, 100) : job.kind === "research" ? researchQueries(context) : []
  if (job.kind === "research" && !context) throw new Error("Set the product context in SEO settings before competitor research")
  for (let keyword of [...new Set(queries)]) {
   try {
    let url = new URL(job.kind === "research" ? "https://www.bing.com/search" : "https://www.google.com/search")
    url.search = new URLSearchParams(job.kind === "research" ? { q: keyword } : { q: keyword, hl: job.config.language, gl: job.config.country, pws: "0", num: "20" }).toString()
    let page = await navigate(url.href)
    let snapshot = job.kind === "research" ? extractBingSerp(page.html, page.url) : extractSerp(page.html, page.url)
    for (let entry of snapshot.entries) {
     let redirect = new URL(entry.url)
     if (redirect.hostname !== "www.google.com" || !["/goto", "/url"].includes(redirect.pathname)) continue
     try {
      if (!(await authorized(job.id))) throw new Error("Job cancelled")
      await sleep(1000)
      let response = await fetch(redirect, { redirect: "manual", signal: AbortSignal.timeout(15000) })
      let target = response.headers.get("location")
      if (!target || !/^https?:\/\//.test(target)) throw new Error("Unresolved Google result redirect")
      let resolved = await publicUrl(target)
      entry.url = resolved.href; entry.domain = resolved.hostname
     } catch { entry.unresolved = true; result.errors.push({ keyword, error: "Could not resolve a result destination" }) }
    }
    let rank = rankResult(snapshot, root.hostname)
    result.snapshots.push({ keyword, ...snapshot, ...rank })
    result.suggestions.push(...snapshot.suggestions.map(text => ({ keyword: text, seed: keyword })))
    if (snapshot.blocked) { result.errors.push({ keyword, error: "Search engine blocked this request; research paused" }); break }
    if (rank.status === "unknown") result.errors.push({ keyword, error: "SERP layout could not be parsed" })
   } catch (error) { result.errors.push({ keyword, error: error.message }); if (/cancelled|authorization|rate.limit|captcha|challenge|consent|blocked/i.test(error.message)) break }
  }
  let discovered = job.kind === "research" ? competitorCandidates(result.snapshots, context, root.hostname, knownCompetitors) : []
  let confirmed = []
  if (job.kind === "research") {
   for (let domain of knownCompetitors) if (!discovered.some(item => item.domain === domain)) discovered.push({ domain, appearances: 0, best_position: null, matched_terms: [], result_url: `https://${domain}/`, result_title: domain })
   for (let candidate of discovered.slice(0, 10)) {
    try {
     let inspectionUrl = candidateInspectionUrl(candidate)
     if (!inspectionUrl) continue
     let rendered = await navigate(inspectionUrl)
     let page = extractPage(rendered.html, rendered.url)
     let verified = validateCompetitor(candidate, page, context, knownCompetitors)
     if (verified) confirmed.push(verified)
    } catch (error) { result.errors.push({ url: candidate.result_url, error: error.message }); if (/cancelled|authorization/.test(error.message)) break }
   }
   for (let competitor of confirmed.slice(0, 3)) queries.push(`"${competitor.domain}" -site:${competitor.domain} resources`)
   for (let keyword of [...new Set(queries)].slice(3)) {
    try {
     let url = new URL("https://www.bing.com/search"); url.search = new URLSearchParams({ q: keyword }).toString()
     let page = await navigate(url.href)
     let snapshot = extractBingSerp(page.html, page.url)
     result.snapshots.push({ keyword, ...snapshot })
     if (snapshot.blocked) { result.errors.push({ keyword, error: "Search engine blocked this request; link research paused" }); break }
    } catch (error) { result.errors.push({ keyword, error: error.message }); if (/cancelled|authorization|rate.limit|captcha|challenge|consent|blocked/i.test(error.message)) break }
   }
  }
  let candidates = job.kind === "audit" ? job.config.render_urls.slice(0, 5) : job.kind === "research" ? [...new Set([...job.config.link_candidates, ...result.snapshots.flatMap(s => s.entries.map(e => e.url))])].filter(url => { try { let host = new URL(url).hostname; return host !== root.hostname && !confirmed.some(item => host === item.domain || host.endsWith(`.${item.domain}`)) } catch { return false } }).slice(0, 20) : []
  for (let address of candidates) {
   try {
    let rendered = await navigate(address)
    let page = extractPage(rendered.html, rendered.url)
    await publicUrl(page.url)
    page.source = "Rendered DOM";page.collected_at = new Date().toISOString()
    result.pages.push(page)
    if (job.kind === "research") {
     let matches = domain => page.links.filter(link => { try { let host = new URL(link).hostname; return host === domain || host.endsWith(`.${domain}`) } catch { return false } })
     let owned = matches(root.hostname), linkedCompetitors = confirmed.flatMap(item => matches(item.domain))
     if (owned.length || linkedCompetitors.length) result.prospects.push({ url: page.url, title: page.title, owned_links: owned, competitor_links: linkedCompetitors, status: "observed", evidence: page.excerpt.slice(0, 500) })
    }
   } catch (error) { result.errors.push({ url: address, error: error.message }); if (/cancelled|authorization/.test(error.message)) break }
  }
  if (job.kind === "research") result.competitors = confirmed
  // Audit HTTP pages and issues remain the baseline; rendered observations are additional evidence.
  let incomplete = result.errors.length > 0
  if (job.kind === "audit") { result.render_errors = result.errors; delete result.errors; result.rendered_pages = result.pages;delete result.pages;delete result.source;delete result.collected_at }
  if (await authorized(job.id)) await send({ id: job.id, status: incomplete ? "partial" : "succeeded", result })
 }
}
await producer.connect(); await scrapeConsumer.connect()
await scrapeConsumer.subscribe({ topic: scrapeResponses, fromBeginning: false })
await scrapeConsumer.run({ eachMessage: async ({ message }) => {
 let id = message.key?.toString()
 if (!id?.startsWith("sitelytics-seo:")) return
 let resolve = pending.get(id)
 if (!resolve) return
 try { resolve(JSON.parse(message.value.toString())) } catch { resolve({ status: "failed", error: { message: "Invalid Chrome queue response" } }) }
}})
await consumer.connect()
await consumer.subscribe({ topic: "sitelytics.seo.browser.requests", fromBeginning: true })
let heartbeatTimer = setInterval(() => send({ type: "heartbeat", time: new Date().toISOString() }).catch(() => {}), 30000)
await send({ type: "heartbeat", time: new Date().toISOString() })
await consumer.run({ autoCommit: false, eachMessage: async ({ topic, partition, message, heartbeat }) => {
 let job
 let keepAlive = setInterval(() => heartbeat().catch(() => {}), 10000)
 try { job = JSON.parse(message.value.toString()); await processJob(job, heartbeat) }
 catch (error) { if (job?.id) await send({ id: job.id, status: "failed", error: error.message, result: {} }); else console.error("Invalid SEO browser request") }
 finally { clearInterval(keepAlive) }
 await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }])
}})
let shutdown = async () => { clearInterval(heartbeatTimer);await consumer.disconnect();await scrapeConsumer.disconnect();await producer.disconnect();process.exit(0) }
process.on("SIGTERM", shutdown);process.on("SIGINT", shutdown)
