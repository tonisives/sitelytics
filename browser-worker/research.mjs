let stop = new Set("a an and are as at be by for from how in into is it of on or our the their to we what with your you about best find get new online platform software tool tools app apps service services".split(" "))
let ignoredHosts = new Set(["youtube.com", "reddit.com", "quora.com", "linkedin.com", "facebook.com", "instagram.com", "pinterest.com", "wikipedia.org", "medium.com", "amazon.com", "github.com"])
let stem = word => word.replace(/(ies|ing|ers|er|ed|s)$/, match => match === "ies" ? "y" : "")
export let contextTerms = context => [...new Set((context.toLowerCase().match(/[a-z]{3,}/g) || []).filter(word => !stop.has(word)).map(stem).filter(word => word.length >= 3))]
export let matchedTerms = (context, value) => {
 let words = new Set(contextTerms(value))
 return contextTerms(context).filter(word => words.has(word))
}
let focusTerms = context => contextTerms(context.split(/[,;.!?\n]/)[0]).slice(0, 5)
let hasContext = (context, matches) => matches.length >= 2 && matches.some(word => focusTerms(context).includes(word))
export let researchQueries = context => {
 let phrase = context.trim().split(/[.!?\n]/)[0].slice(0, 100)
 return [`${phrase} tools`, `${phrase} alternatives`, `${phrase} for businesses`]
}
export let isCandidateHost = (host, ownHost) => {
 let normalized = host.replace(/^www\./, "")
 let own = ownHost.replace(/^www\./, "")
 return normalized !== own && !normalized.endsWith(`.${own}`) && ![...ignoredHosts].some(domain => normalized === domain || normalized.endsWith(`.${domain}`)) && !/^(google|bing|yahoo)\./.test(normalized)
}
export let competitorCandidates = (snapshots, context, ownHost, known = []) => {
 let domains = new Map()
 for (let snapshot of snapshots) for (let entry of snapshot.entries || []) {
  let domain = entry.domain?.replace(/^www\./, "")
  if (!domain || entry.unresolved || !isCandidateHost(domain, ownHost)) continue
  let matches = matchedTerms(context, `${entry.title || ""} ${entry.snippet || ""}`)
  if (!hasContext(context, matches) && !known.includes(domain)) continue
  let current = domains.get(domain) || { domain, appearances: 0, best_position: null, matched_terms: [], result_url: entry.url, result_title: entry.title }
  current.appearances++
  current.best_position = Math.min(current.best_position ?? Infinity, entry.position)
  current.matched_terms = [...new Set([...current.matched_terms, ...matches])]
  domains.set(domain, current)
 }
 return [...domains.values()].sort((a, b) => b.appearances - a.appearances || b.matched_terms.length - a.matched_terms.length || a.best_position - b.best_position).slice(0, 12)
}
export let validateCompetitor = (candidate, page, context, known = []) => {
 let host
 try { host = new URL(page.url).hostname.replace(/^www\./, "") } catch { return null }
 if (host !== candidate.domain && !host.endsWith(`.${candidate.domain}`)) return null
 let matches = matchedTerms(context, `${page.title || ""} ${page.description || ""} ${(page.h1 || []).join(" ")} ${page.excerpt || ""}`)
 if (!hasContext(context, matches) && !known.includes(candidate.domain)) return null
 return { ...candidate, matched_terms: [...new Set([...candidate.matched_terms, ...matches])], page_url: page.url, page_title: page.title, description: page.description, confirmed_by: known.includes(candidate.domain) ? "Saved competitor" : "Context match on website" }
}
