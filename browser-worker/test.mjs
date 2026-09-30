import { fetchPublicHtml } from "./http.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { extractBingSerp, extractDuckDuckGoLite, extractPage, extractSerp, rankResult } from "./extract.mjs"
import { candidateInspectionUrl, competitorCandidates, prospectUrls, topicalProspect, validateCompetitor } from "./research.mjs"
test("unknown is distinct from not observed", () => {
 assert.equal(rankResult({ entries: [] }, "example.com").status, "unknown")
 assert.equal(rankResult({ entries: [], blocked: true }, "example.com").status, "blocked")
 assert.equal(rankResult({ entries: [{ domain: "other.com", position: 1 }] }, "example.com").status, "not_found_in_observed_results")
})
test("domain boundary and subdomain ranking", () => {
 let result = rankResult({ entries: [{ domain: "notexample.com", position: 1 }, { domain: "www.example.com", position: 2, url: "https://www.example.com/a" }] }, "example.com")
 assert.equal(result.position, 2)
})
test("rendered SERP HTML preserves absolute destinations and observed ranks", () => {
 let html = '<html lang="en"><body><div id="search"><div class="MjjYud"><a href="/url?q=https%3A%2F%2Fexample.com%2Fpage"><h3>Example</h3></a><p>Snippet</p></div></div></body></html>'
 let result = extractSerp(html, "https://www.google.com/search?q=example")
 assert.equal(result.entries[0].url, "https://example.com/page")
 assert.equal(rankResult(result, "example.com").position, 1)
})
test("rendered page HTML resolves links against the final URL", () => {
 let page = extractPage('<html><head><title>Example</title><link rel="canonical" href="/canonical"></head><body><h1>Heading</h1><a href="/next">Next</a></body></html>', "https://example.com/start")
 assert.equal(page.canonical, "https://example.com/canonical")
 assert.deepEqual(page.links, ["https://example.com/next"])
 assert.deepEqual(page.h1, ["Heading"])
})
test("Bing HTML resolves redirect destinations for competitor research", () => {
 let encoded = `a1${Buffer.from("https://ideas.example/product").toString("base64")}`
 let html = `<html><body><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=${encoded}">Business idea tool</a></h2><div class="b_caption"><p>Software for founders</p></div></li></body></html>`
 let result = extractBingSerp(html, "https://www.bing.com/search?q=business+ideas")
 assert.deepEqual(result.entries.map(entry => [entry.domain, entry.url, entry.position]), [["ideas.example", "https://ideas.example/product", 1]])
})
test("DuckDuckGo Lite resolves result destinations and snippets", () => {
 let target = "https://ideas.example/product"
 let html = `<html><body><table><tr><td><a class="result-link" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}">Business idea tool</a></td></tr><tr><td>Software for founders</td></tr></table></body></html>`
 let result = extractDuckDuckGoLite(html, "https://lite.duckduckgo.com/lite/?q=business+ideas")
 assert.deepEqual(result.entries.map(entry => [entry.domain, entry.url, entry.position, entry.snippet]), [["ideas.example", target, 1, "Software for founders"]])
})
test("context research excludes stock analysis and confirms product matches", () => {
 let context = "Business idea discovery, early market signals for founders"
 let snapshots = [{ entries: [
  { domain: "stocks.example", position: 1, url: "https://stocks.example/", title: "Trend Seeker stock price technical analysis", snippet: "Trading charts and early market signals" },
  { domain: "ideas.example", position: 2, url: "https://ideas.example/", title: "Find business ideas", snippet: "Discover emerging market signals for founders" },
  { domain: "youtube.com", position: 3, url: "https://youtube.com/watch", title: "Business idea discovery", snippet: "Market signals" }
 ] }]
 let candidates = competitorCandidates(snapshots, context, "trend-seeker.app")
 assert.deepEqual(candidates.map(item => item.domain), ["ideas.example"])
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/", title: "Business idea discovery tool", description: "Emerging market signals for founders", h1: [], excerpt: "" }, context)?.domain, "ideas.example")
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/", title: "Startup analysis platform", description: "Validate your business idea with market research", h1: [], excerpt: "" }, context), null)
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/", title: "Find a business idea", description: "Free tools to identify startup opportunities", h1: [], excerpt: "" }, context)?.domain, "ideas.example")
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/", title: "Stock charts", description: "Technical analysis", h1: [], excerpt: "" }, context), null)
 assert.equal(candidateInspectionUrl({ domain: "ideas.example", result_url: "https://ideas.example/blog/best-tools" }), "https://ideas.example/")
 assert.equal(candidateInspectionUrl({ domain: "ideas.example", result_url: "https://ideas.example/product" }), "https://ideas.example/")
 assert.equal(candidateInspectionUrl({ domain: "blog.writer.example", result_url: "https://blog.writer.example/best-tools" }), null)
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/blog/best-tools", title: "Business idea discovery tools", description: "Software for founders", h1: [], excerpt: "" }, context), null)
})
test("topical outreach ideas require relevant editorial pages with external links", () => {
 let page = { url: "https://publisher.example/blog/best-business-idea-tools", title: "Best business idea discovery tools", description: "Find startup opportunities", h1: [], links: ["https://one.example/", "https://two.example/"] }
 assert.equal(topicalProspect(page, "Business idea discovery, startup opportunity research"), true)
 assert.equal(topicalProspect({ ...page, url: "https://publisher.example/" }, "Business idea discovery, startup opportunity research"), true)
 assert.equal(topicalProspect({ ...page, title: "Stock chart tools", description: "Technical analysis", url: "https://publisher.example/blog/stocks" }, "Business idea discovery, startup opportunity research"), false)
 assert.equal(topicalProspect({ ...page, url: "https://github.com/project" }, "Business idea discovery, startup opportunity research"), false)
})
test("competitor-link searches are inspected before broad discovery results", () => {
 let discovery = { purpose: "competitor_discovery", entries: Array.from({ length: 30 }, (_,i) => ({url:`https://publisher.example/article/${i}`})) }
 let links = { purpose: "link_discovery", entries: [{url:"https://directory.example/competitor"},{url:"https://www.owned.example/"},{url:"https://competitor.example/"}] }
 let urls = prospectUrls({link_candidates:[]}, [discovery,links], "owned.example", [{domain:"competitor.example"}])
 assert.equal(urls[0], "https://directory.example/competitor")
 assert.equal(urls.length, 25)
 assert(!urls.includes("https://www.owned.example/"))
 assert(!urls.includes("https://competitor.example/"))
})
test("challenge pages are not treated as product evidence", () => {
 assert.equal(extractPage('<html><title>Vercel Security Checkpoint</title><body>Checking your browser</body></html>', "https://ideas.example/").blocked, true)
})

test("public HTML fallback validates redirects and refuses private destinations", async () => {
 let checked = []
 let validate = async address => { let url = new URL(address); checked.push(url.href); if (url.hostname === "127.0.0.1") throw new Error("Non-public destination"); return url }
 let fetchPage = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
 await assert.rejects(fetchPublicHtml("https://public.example/", validate, { fetchPage }), /Non-public destination/)
 assert.deepEqual(checked, ["https://public.example/", "http://127.0.0.1/private"])
})
test("public HTML fallback preserves source and bounds the streamed body", async () => {
 let validate = async address => new URL(address)
 let fetchPage = async () => new Response("<title>Article</title>", { headers: { "content-type": "text/html" } })
 let page = await fetchPublicHtml("https://public.example/", validate, { fetchPage })
 assert.equal(page.source, "Remote HTTP HTML")
 assert.equal(extractPage(page.html, page.url).title, "Article")
 await assert.rejects(fetchPublicHtml("https://public.example/", validate, { fetchPage, limit: 5 }), /size limit/)
})
test("page evidence excludes scripts and product-feedback articles are not startup idea prospects", () => {
 let page = extractPage('<title>15 Best Product Discovery Tools</title><meta name="description" content="Market discovery and business feedback"><body><script>find startup ideas</script><main><p>Actual article</p><a href="https://a.example/">A</a><a href="https://b.example/">B</a></main></body>', "https://publisher.example/blog/tools")
 assert.equal(page.excerpt, "Actual articleAB")
 assert.equal(topicalProspect(page, "Business idea discovery, early market signals for founders"), false)
})
