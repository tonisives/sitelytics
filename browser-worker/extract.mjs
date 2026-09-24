// Browser functions are serialized into the worker-owned bmux pane.
export let extractSerp = () => {
 let body = document.body?.innerText || ""
 if (/unusual traffic|not a robot|before you continue to google/i.test(body) || location.pathname.startsWith("/sorry")) return { blocked: true, entries: [], suggestions: [], actual_url: location.href }
 let entries = [], seen = new Set()
 for (let heading of document.querySelectorAll("#search h3, #rso h3")) {
  let anchor = heading.closest("a"), href = anchor?.href
  if (!href) continue
  let url
  try { url = new URL(href); if (url.pathname === "/url" && /^https?:/.test(url.searchParams.get("q") || url.searchParams.get("url") || "")) url = new URL(url.searchParams.get("q") || url.searchParams.get("url")) } catch { continue }
  if (!/^https?:$/.test(url.protocol) || (/(^|\.)google\.[a-z.]+$/.test(url.hostname) && !["/goto", "/url"].includes(url.pathname)) || seen.has(url.href)) continue
  let block = heading.closest("div.MjjYud") || anchor.parentElement
  if (block?.querySelector("[data-text-ad], [data-ad-slot]") || /^(Sponsored|Ads)\b/.test(block?.innerText || "")) continue
  seen.add(url.href)
  entries.push({ position: entries.length + 1, url: url.href, domain: url.hostname, title: heading.innerText, snippet: (block?.innerText || "").slice(0, 1500) })
  if (entries.length >= 20) break
 }
 let suggestions = [...document.querySelectorAll("a[href*='/search?']")].filter(a => a.querySelector("b, strong") || a.closest("#bres")).map(a => a.innerText.trim()).filter(s => s.length > 2 && s.length < 200)
 return { entries, suggestions: [...new Set(suggestions)].slice(0, 20), blocked: false, actual_url: location.href, language: document.documentElement.lang, explicit_empty: /did not match any documents|no results found/i.test(body) }
}
export let extractPage = () => ({
 url: location.href, title: document.title, description: document.querySelector("meta[name='description']")?.content || "",
 h1: [...document.querySelectorAll("h1")].map(h => h.innerText),
 canonical: document.querySelector("link[rel~='canonical']")?.href || null,
 noindex: /noindex/i.test(document.querySelector("meta[name='robots']")?.content || ""),
 links: [...new Set([...document.querySelectorAll("a[href]")].map(a => a.href).filter(h => /^https?:\/\//.test(h)))].slice(0, 500),
 text_length: document.body?.innerText.length || 0,
 excerpt: (document.body?.innerText || "").slice(0, 3000)
})
export let rankResult = (snapshot, domain) => {
 let found = snapshot.entries.find(entry => entry.domain === domain || entry.domain.endsWith(`.${domain}`))
 return { position: found?.position ?? null, ranking_url: found?.url ?? null, status: snapshot.blocked ? "blocked" : snapshot.entries.length ? (found ? "found" : snapshot.entries.some(e => e.unresolved) ? "unknown" : "not_found_in_observed_results") : snapshot.explicit_empty ? "no_results" : "unknown", observed_depth: snapshot.entries.length }
}
