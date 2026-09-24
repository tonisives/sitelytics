import { test } from "node:test"
import assert from "node:assert/strict"
import { extractPage, extractSerp, rankResult } from "./extract.mjs"
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
