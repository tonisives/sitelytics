export let fetchPublicHtml = async (address, validate, { fetchPage = fetch, limit = 2097152 } = {}) => {
 let url = await validate(address)
 for (let redirects = 0; redirects < 6; redirects++) {
  let response = await fetchPage(url, { redirect: "manual", headers: { "User-Agent": "SitelyticsSEO/1.0" }, signal: AbortSignal.timeout(20000) })
  if ([301,302,303,307,308].includes(response.status)) {
   let location = response.headers.get("location")
   await response.body?.cancel()
   if (!location) throw new Error("Public page redirect has no destination")
   url = await validate(new URL(location, url))
   continue
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Public page returned HTTP ${response.status}`) }
  let type = response.headers.get("content-type") || ""
  if (type && !type.includes("html")) { await response.body?.cancel(); throw new Error("Public page is not HTML") }
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("Public page exceeds the HTML size limit") }
  let reader = response.body?.getReader()
  if (!reader) throw new Error("Public page has no HTML body")
  let chunks = [], size = 0
  try {
   while (true) {
    let { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) throw new Error("Public page exceeds the HTML size limit")
    chunks.push(Buffer.from(value))
   }
  } finally { await reader.cancel() }
  return { html: Buffer.concat(chunks).toString("utf8"), url: url.href, source: "Remote HTTP HTML" }
 }
 throw new Error("Public page redirected too many times")
}
