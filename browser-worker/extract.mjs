import { load } from "cheerio"

let absolute = (href, base) => { try { return new URL(href, base).href } catch { return null } }

export let extractSerp = (html, pageUrl) => {
 let $ = load(html), body = $("body").text()
 if (/unusual traffic|not a robot|before you continue to google/i.test(body) || new URL(pageUrl).pathname.startsWith("/sorry")) return { blocked: true, entries: [], suggestions: [], actual_url: pageUrl }
 let entries = [], seen = new Set()
 $("#search h3, #rso h3").each((_, heading) => {
  if (entries.length >= 20) return
  let anchor = $(heading).closest("a"), href = absolute(anchor.attr("href"), pageUrl)
  if (!href) return
  let url
  try { url = new URL(href); if (url.pathname === "/url" && /^https?:/.test(url.searchParams.get("q") || url.searchParams.get("url") || "")) url = new URL(url.searchParams.get("q") || url.searchParams.get("url")) } catch { return }
  if (!/^https?:$/.test(url.protocol) || (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && !["/goto", "/url"].includes(url.pathname)) || seen.has(url.href)) return
  let block = $(heading).closest("div.MjjYud"); if (!block.length) block = anchor.parent()
  if (block.find("[data-text-ad], [data-ad-slot]").length || /^(Sponsored|Ads)\b/.test(block.text().trim())) return
  seen.add(url.href)
  entries.push({ position: entries.length + 1, url: url.href, domain: url.hostname, title: $(heading).text().trim(), snippet: block.text().trim().slice(0, 1500) })
 })
 let suggestions = $("a[href*='/search?']").toArray().filter(a => $(a).find("b, strong").length || $(a).closest("#bres").length).map(a => $(a).text().trim()).filter(s => s.length > 2 && s.length < 200)
 return { entries, suggestions: [...new Set(suggestions)].slice(0, 20), blocked: false, actual_url: pageUrl, language: $("html").attr("lang"), explicit_empty: /did not match any documents|no results found/i.test(body) }
}

export let extractBingSerp = (html, pageUrl) => {
 let $ = load(html), entries = [], seen = new Set()
 $("li.b_algo").each((_, result) => {
  let anchor = $(result).find("h2 a").first(), href = absolute(anchor.attr("href"), pageUrl)
  if (!href || entries.length >= 20) return
  let url
  try {
   url = new URL(href)
   if (url.hostname === "www.bing.com" && url.pathname === "/ck/a") {
    let encoded = url.searchParams.get("u") || ""
    if (!encoded.startsWith("a1")) return
    url = new URL(Buffer.from(encoded.slice(2), "base64").toString("utf8"))
   }
  } catch { return }
  if (!/^https?:$/.test(url.protocol) || seen.has(url.href)) return
  seen.add(url.href)
  entries.push({ position: entries.length + 1, url: url.href, domain: url.hostname, title: anchor.text().trim(), snippet: $(result).find(".b_caption p").first().text().trim().slice(0, 1500) })
 })
 return { entries, suggestions: [], blocked: /unusual traffic|verify you are a human|captcha/i.test($("body").text()), actual_url: pageUrl, explicit_empty: /no results found|there are no results/i.test($("body").text()) }
}

export let extractDuckDuckGoLite = (html, pageUrl) => {
 let $ = load(html), entries = [], seen = new Set()
 $("a.result-link").each((_, anchor) => {
  if (entries.length >= 20) return
  let href = absolute($(anchor).attr("href"), pageUrl)
  if (!href) return
  let url
  try {
   url = new URL(href)
   if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") url = new URL(url.searchParams.get("uddg"))
  } catch { return }
  if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) return
  seen.add(url.href)
  let row = $(anchor).closest("tr")
  entries.push({ position: entries.length + 1, url: url.href, domain: url.hostname, title: $(anchor).text().trim(), snippet: row.next().text().trim().slice(0, 1500) })
 })
 let body = $("body").text()
 return { entries, suggestions: [], blocked: /automated requests|verify you are human|captcha|unusual traffic/i.test(body), actual_url: pageUrl, explicit_empty: /no results found|no results\./i.test(body) }
}

export let extractPage = (html, pageUrl) => {
 let $ = load(html), body = $("body").text()
 return {
  url: pageUrl, title: $("title").first().text(), description: $("meta[name='description']").attr("content") || "",
  h1: $("h1").toArray().map(h => $(h).text().trim()),
  canonical: absolute($("link[rel~='canonical']").attr("href"), pageUrl),
  noindex: /noindex/i.test($("meta[name='robots']").attr("content") || ""),
  links: [...new Set($("a[href]").toArray().map(a => absolute($(a).attr("href"), pageUrl)).filter(h => h && /^https?:\/\//.test(h)))].slice(0, 500),
  text_length: body.length, excerpt: body.trim().slice(0, 3000)
 }
}

export let rankResult = (snapshot, domain) => {
 let found = snapshot.entries.find(entry => entry.domain === domain || entry.domain.endsWith(`.${domain}`))
 return { position: found?.position ?? null, ranking_url: found?.url ?? null, status: snapshot.blocked ? "blocked" : snapshot.entries.length ? (found ? "found" : snapshot.entries.some(e => e.unresolved) ? "unknown" : "not_found_in_observed_results") : snapshot.explicit_empty ? "no_results" : "unknown", observed_depth: snapshot.entries.length }
}
