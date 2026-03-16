export type GscMetrics = {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type DailyRow = {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  ga_sessions?: number
}

export type PropertyData = {
  site_url: string
  permission_level: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  daily: DailyRow[]
  ga_sessions?: number
  ga_property_id?: string
}

export type DashboardData = {
  properties: PropertyData[]
  totals: GscMetrics
  fetched_at: string
}

export type DimensionRow = {
  key: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export type GaPropertyData = {
  total: number
  daily: number[]
  daily_dated: [string, number][]
  property_id: string
}

export type GaSessionsData = {
  property_id: string
  daily: [string, number][]
  total: number
}
