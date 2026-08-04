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

export type CurrentUser = { id: string; email: string; display_name?: string; avatar_url?: string; is_admin: boolean }
export type AeoCadence = "weekly" | "monthly"
export type AeoQueryKind = "discovery" | "branded"
export type AeoVisibilityLevel = "absent" | "cited" | "mentioned" | "recommended" | "top_pick"
export type AeoProperty = { id: string; site_url: string; brand_name: string; owned_domain: string; aliases: string[] }
export type AeoQuery = { id: string; property_id: string; prompt: string; kind: AeoQueryKind; cadence: AeoCadence; active: boolean; next_run_at: string }
export type AeoResult = { query_id: string; prompt: string; kind: AeoQueryKind; cadence: AeoCadence; run_id?: string; scheduled_for?: string; provider?: string; sample_number?: number; status?: string; level?: AeoVisibilityLevel; rank?: number; owned_domain_cited?: boolean; evidence?: string; citations: string[]; competitors: string[]; error_code?: string; latency_ms?: number }
export type AeoDashboardRow = { site_url: string; known: number; unknown: number; mentioned: number; recommended: number }
export type AdminUsage = { users:number; signups_7d:number; active_aeo_users:number; active_queries:number; backlog:number; samples_7d:number; success_7d:number; blocked_7d:number; active_sessions:number; average_latency_ms?:number; providers:Array<{provider:string;circuit_open_until?:string;last_success_at?:string;last_error_code?:string;consecutive_failures:number}>; recent_failures:Array<{provider:string;error_code?:string;completed_at?:string;prompt:string}> }
