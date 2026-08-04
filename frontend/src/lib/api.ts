import type { DashboardData, PropertyData, DimensionRow, GaSessionsData, GaPropertyData, CurrentUser, AeoProperty, AeoQuery, AeoResult, AeoDashboardRow, AdminUsage, AeoCadence, AeoQueryKind } from "../types"

let fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  let res = await fetch(url, { credentials: "include", ...init })
  if (!res.ok) {
    let text = await res.text().catch(() => "")
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json()
}

export let fetchGscData = (days: number): Promise<DashboardData> =>
  fetchJson(`/api/gsc/dashboard?days=${days}`)

export let fetchPropertyDetail = (siteUrl: string, days: number): Promise<PropertyData> =>
  fetchJson(`/api/gsc/property?site_url=${encodeURIComponent(siteUrl)}&days=${days}`)

export let fetchDimension = (siteUrl: string, dimension: string, days: number): Promise<DimensionRow[]> =>
  fetchJson(`/api/gsc/dimension?site_url=${encodeURIComponent(siteUrl)}&dimension=${dimension}&days=${days}`)

export let fetchGaSessions = (siteUrl: string, days: number, metric: string): Promise<GaSessionsData | null> =>
  fetchJson(`/api/ga/metric?site_url=${encodeURIComponent(siteUrl)}&days=${days}&metric=${metric}`)

export let fetchAllGaSessions = (siteUrls: string[], days: number): Promise<Record<string, GaPropertyData>> =>
  fetchJson("/api/ga/dashboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ site_urls: siteUrls, days }),
  })

export let logout = (): Promise<void> =>
  fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(() => {})

let jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
export let fetchMe = (): Promise<CurrentUser> => fetchJson("/api/me")
export let fetchAeoProperty = (siteUrl: string): Promise<AeoProperty> => fetchJson(`/api/aeo/property?site_url=${encodeURIComponent(siteUrl)}`)
export let saveAeoProperty = (value: Omit<AeoProperty,"id">): Promise<AeoProperty> => fetchJson("/api/aeo/property", jsonInit("PUT", value))
export let fetchAeoQueries = (siteUrl: string): Promise<AeoQuery[]> => fetchJson(`/api/aeo/queries?site_url=${encodeURIComponent(siteUrl)}`)
export let createAeoQuery = (value: {site_url:string;prompt:string;cadence:AeoCadence;kind?:AeoQueryKind}): Promise<AeoQuery> => fetchJson("/api/aeo/queries", jsonInit("POST", value))
export let updateAeoQuery = (id: string, value: Partial<Pick<AeoQuery,"prompt"|"cadence"|"kind"|"active">>): Promise<AeoQuery> => fetchJson(`/api/aeo/queries/${id}`, jsonInit("PATCH", value))
export let deleteAeoQuery = (id: string): Promise<void> => fetch(`/api/aeo/queries/${id}`, {method:"DELETE",credentials:"include"}).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`) })
export let fetchAeoResults = (siteUrl: string): Promise<AeoResult[]> => fetchJson(`/api/aeo/results?site_url=${encodeURIComponent(siteUrl)}`)
export let fetchAeoDashboard = (siteUrls: string[]): Promise<AeoDashboardRow[]> => fetchJson("/api/aeo/dashboard", jsonInit("POST", {site_urls:siteUrls}))
export let fetchAdminUsage = (): Promise<AdminUsage> => fetchJson("/api/admin/usage")
