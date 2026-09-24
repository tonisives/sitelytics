import { test } from "node:test"
import assert from "node:assert/strict"
import { rankResult } from "./extract.mjs"
test("unknown is distinct from not observed", () => {
 assert.equal(rankResult({ entries: [] }, "example.com").status, "unknown")
 assert.equal(rankResult({ entries: [], blocked: true }, "example.com").status, "blocked")
 assert.equal(rankResult({ entries: [{ domain: "other.com", position: 1 }] }, "example.com").status, "not_found_in_observed_results")
})
test("domain boundary and subdomain ranking", () => {
 let result = rankResult({ entries: [{ domain: "notexample.com", position: 1 }, { domain: "www.example.com", position: 2, url: "https://www.example.com/a" }] }, "example.com")
 assert.equal(result.position, 2)
})
