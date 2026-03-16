import type { DashboardData, PropertyData, DimensionRow, GaSessionsData, GaPropertyData } from "../types"

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
