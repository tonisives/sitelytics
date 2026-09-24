import { test } from "node:test"
import assert from "node:assert/strict"
import { extractBingSerp, extractPage, extractSerp, rankResult } from "./extract.mjs"
import { candidateInspectionUrl, competitorCandidates, validateCompetitor } from "./research.mjs"
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
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/", title: "Stock charts", description: "Technical analysis", h1: [], excerpt: "" }, context), null)
 assert.equal(candidateInspectionUrl({ domain: "ideas.example", result_url: "https://ideas.example/blog/best-tools" }), "https://ideas.example/")
 assert.equal(candidateInspectionUrl({ domain: "blog.writer.example", result_url: "https://blog.writer.example/best-tools" }), null)
 assert.equal(validateCompetitor(candidates[0], { url: "https://ideas.example/blog/best-tools", title: "Business idea discovery tools", description: "Software for founders", h1: [], excerpt: "" }, context), null)
})
