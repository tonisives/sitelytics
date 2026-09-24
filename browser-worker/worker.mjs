import { Kafka, logLevel } from "kafkajs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { lookup } from "node:dns/promises"
import { readFile, writeFile, unlink } from "node:fs/promises"
import { isIP, connect } from "node:net"
import { extractSerp, extractPage, rankResult } from "./extract.mjs"
let exec = promisify(execFile)
let brokers = process.env.KAFKA_BROKERS?.split(",")
let base = process.env.SITELYTICS_URL
let token = process.env.SEO_BROWSER_TOKEN
if (!brokers?.length || !base || !token) throw new Error("KAFKA_BROKERS, SITELYTICS_URL and SEO_BROWSER_TOKEN are required")
let tunnelPort = Number(process.env.KAFKA_TUNNEL_PORT || 0)
let socketFactory = tunnelPort ? ({ onConnect }) => connect({ host: "127.0.0.1", port: tunnelPort }, onConnect) : undefined
let kafka = new Kafka({ clientId: "sitelytics-seo-bmux", brokers, logLevel: logLevel.ERROR, ...(socketFactory ? { socketFactory } : {}) })
let producer = kafka.producer()
let consumer = kafka.consumer({ groupId: "sitelytics-seo-bmux-v1", sessionTimeout: 60000 })
let responseTopic = "sitelytics.seo.browser.responses"
let bmux = process.env.BMUX_BIN || "bmux"
let sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let command = async args => {
 let stdout
 try { ({ stdout } = await exec(bmux, args, { timeout: 65000, maxBuffer: 3_000_000 })) }
 catch (error) { throw new Error(error.killed ? "Browser action timed out" : "Browser action failed") }
 let result = JSON.parse(stdout)
 if (!result.ok) throw new Error(result.error?.message || "bmux command failed")
 return result.result
}
let evaluate = async (pane, fn) => {
 let value = await command(["eval", "-t", pane, `JSON.stringify((${fn.toString()})())`])
 if (typeof value === "string") return JSON.parse(value)
 if (typeof value?.value === "string") return JSON.parse(value.value)
 throw new Error("Unexpected bmux evaluation response")
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
let ownershipFile = new URL("./.active-pane.json", import.meta.url)
try {
 let previous = JSON.parse(await readFile(ownershipFile, "utf8"))
 if (previous.pane) await command(["kill-pane", "-t", previous.pane, "--confirm"])
 await unlink(ownershipFile)
} catch {}
let lastGoogle = 0
let processJob = async (job, heartbeat) => {
 if (job.version !== 1 || !["rankings", "research", "audit"].includes(job.kind) || !/^[a-f0-9-]{36}$/.test(job.id)) throw new Error("Unsupported browser job")
 if (Date.parse(job.expires_at) < Date.now() || !(await authorized(job.id))) return
 let root = await publicUrl(job.config.root_url), pane
 let result = { source: "bmux browser observation", collected_at: new Date().toISOString(), browser_context: { device: "desktop", requested_country: job.config.country, requested_language: job.config.language, location_precision: "Browser IP region; requested country is a hint, not verified geolocation" }, snapshots: [], pages: [], prospects: [], suggestions: [], errors: [] }
 let navigate = async address => {
  if (!(await authorized(job.id))) throw new Error("Job cancelled")
  await heartbeat()
  let url = await publicUrl(address)
  if (url.hostname === "www.google.com") { await sleep(Math.max(0, 10000 - (Date.now() - lastGoogle))); lastGoogle = Date.now() }
  await command(["navigate", "-t", pane, url.href])
  await command(["wait", "-t", pane, "--selector", "body", "--state", "visible"])
  await command(["wait", "-t", pane, "--ms", "1500"])
 }
 try {
  let created = await command(["new-session", "-s", `sitelytics-seo-${job.id}`, "--profile", "bot"])
  pane = created.windows?.[0]?.panes?.[0]?.id
  if (!pane) throw new Error("bmux did not return a pane ID")
  await writeFile(ownershipFile, JSON.stringify({ pane, job: job.id }), { mode: 0o600 })
  await command(["cdp", "-t", pane, "Emulation.setDeviceMetricsOverride", JSON.stringify({ width: 1365, height: 900, deviceScaleFactor: 1, mobile: false })])
  let queries = job.kind === "audit" ? [] : job.config.keywords.slice(0, job.kind === "rankings" ? 100 : 10)
  if (job.kind === "research") {
   for (let domain of job.config.competitors.slice(0, 10)) queries.push(`"${domain}" -site:${domain}`)
   for (let keyword of job.config.keywords.slice(0, 5)) queries.push(`${keyword} resources directory`)
  }
  for (let keyword of [...new Set(queries)]) {
   try {
    let url = new URL("https://www.google.com/search");url.search = new URLSearchParams({ q: keyword, hl: job.config.language, gl: job.config.country, pws: "0", num: "20" }).toString()
    await navigate(url.href)
    let snapshot = await evaluate(pane, extractSerp)
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
    if (snapshot.blocked) { result.errors.push({ keyword, error: "Google blocked this request; research paused" }); break }
    if (rank.status === "unknown") result.errors.push({ keyword, error: "SERP layout could not be parsed" })
   } catch (error) { result.errors.push({ keyword, error: error.message }); if (/cancelled|authorization/.test(error.message)) break }
  }
  let candidates = job.kind === "audit" ? job.config.render_urls.slice(0, 5) : job.kind === "research" ? [...new Set([...job.config.link_candidates, ...result.snapshots.flatMap(s => s.entries.map(e => e.url))])].slice(0, 25) : []
  for (let address of candidates) {
   try {
    await navigate(address)
    let page = await evaluate(pane, extractPage)
    await publicUrl(page.url)
    page.source = "Rendered DOM";page.collected_at = new Date().toISOString()
    result.pages.push(page)
    if (job.kind === "research") {
     let matches = domain => page.links.filter(link => { try { let host = new URL(link).hostname; return host === domain || host.endsWith(`.${domain}`) } catch { return false } })
     result.prospects.push({ url: page.url, title: page.title, owned_links: matches(root.hostname), competitor_links: job.config.competitors.flatMap(domain => matches(domain)), status: "inspected", evidence: page.excerpt })
    }
   } catch (error) { result.errors.push({ url: address, error: error.message }); if (/cancelled|authorization/.test(error.message)) break }
  }
  result.competitors = [...new Set(result.snapshots.flatMap(s => s.entries.map(e => e.domain)))].filter(domain => domain !== root.hostname && !domain.endsWith(`.${root.hostname}`))
  // Audit HTTP pages and issues remain the baseline; rendered observations are additional evidence.
  let incomplete = result.errors.length > 0
  if (job.kind === "audit") { result.render_errors = result.errors; delete result.errors; result.rendered_pages = result.pages;delete result.pages;delete result.source;delete result.collected_at }
  if (await authorized(job.id)) await send({ id: job.id, status: incomplete ? "partial" : "succeeded", result })
 } finally {
  if (pane) await command(["kill-pane", "-t", pane, "--confirm"]).then(() => unlink(ownershipFile)).catch(() => {})
 }
}
await producer.connect(); await consumer.connect()
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
let shutdown = async () => { clearInterval(heartbeatTimer);await consumer.disconnect();await producer.disconnect();process.exit(0) }
process.on("SIGTERM", shutdown);process.on("SIGINT", shutdown)
