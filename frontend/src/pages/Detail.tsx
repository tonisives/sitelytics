import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Helmet } from "react-helmet-async"
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid,
} from "recharts"
import type { PropertyData, DailyRow, DimensionRow, GaSessionsData } from "../types"
import { fetchPropertyDetail, fetchGaSessions, fetchDimension } from "../lib/api"
import { formatNumber, formatTipNumber, formatCtr, formatPosition, formatAxisNumber, cleanUrl } from "../lib/format"
import { DayButton } from "../components/DayButton"
import { ThemeToggle } from "../components/ThemeToggle"

let GA_METRICS: [string, string, string][] = [
  ["sessions", "Sessions", "var(--chart-teal)"],
  ["screenPageViews", "Pageviews", "var(--chart-pink)"],
  ["engagedSessions", "Engaged", "var(--chart-teal)"],
  ["bounceRate", "Bounce Rate", "var(--chart-pink)"],
  ["averageSessionDuration", "Avg Duration", "var(--chart-teal)"],
]

type MetricKey = "clicks" | "impressions" | "ctr" | "position"

export let Detail = () => {
  let { site } = useParams<{ site: string }>()
  let siteUrl = site ? decodeURIComponent(site) : ""
  let navigate = useNavigate()

  let [days, setDays] = useState(28)
  let [prop, setProp] = useState<PropertyData | null>(null)
  let [loading, setLoading] = useState(true)
  let [error, setError] = useState<string | null>(null)

  let [gaMetric, setGaMetric] = useState<string | null>(null)
  let [gaData, setGaData] = useState<GaSessionsData | null>(null)
  let [gaLoading, setGaLoading] = useState(false)

  let cacheRef = useRef<Record<string, PropertyData>>({})
  let gaCacheRef = useRef<Record<string, GaSessionsData | null>>({})

  useEffect(() => {
    if (!siteUrl) return
    let cancelled = false
    let key = `${siteUrl}:${days}`
    if (cacheRef.current[key]) {
      setProp(cacheRef.current[key])
      setLoading(false)
    } else {
      setLoading(true)
    }
    fetchPropertyDetail(siteUrl, days)
      .then((result) => {
        if (cancelled) return
        cacheRef.current[key] = result
        setProp(result)
        setError(null)
      })
      .catch((e: any) => {
        if (cancelled) return
        if (e.message?.includes("Not authenticated") || e.message?.includes("401")) {
          navigate("/login")
          return
        }
        setError(e.message || "Failed to load")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [siteUrl, days, navigate])

  useEffect(() => {
    if (!gaMetric || !siteUrl) {
      setGaData(null)
      setGaLoading(false)
      return
    }
    let key = `${siteUrl}:${days}:${gaMetric}`
    if (key in gaCacheRef.current) {
      setGaData(gaCacheRef.current[key])
      setGaLoading(false)
      return
    }
    let cancelled = false
    setGaData(null)
    setGaLoading(true)
    fetchGaSessions(siteUrl, days, gaMetric)
      .then((result) => {
        if (cancelled) return
        gaCacheRef.current[key] = result
        setGaData(result)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGaLoading(false) })
    return () => { cancelled = true }
  }, [siteUrl, days, gaMetric])

  let gscUrl = `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(siteUrl)}`
  let gaPropertyId = prop?.ga_property_id || gaData?.property_id
  let gaUrl = gaPropertyId
    ? `https://analytics.google.com/analytics/web/#/p${gaPropertyId.replace("properties/", "")}/reports/`
    : null

  if (loading && !prop) return <div className="container"><div className="loading">Loading...</div></div>
  if (error) return <div className="container"><div className="error-text">{error}</div></div>
  if (!prop) return null

  return (
    <div className="container">
      <Helmet><title>{cleanUrl(siteUrl)} - Sitelytics</title></Helmet>
      <header className="dash-header">
        <div className="detail-title-row">
          <a href="/" className="back-link">&lt; Back</a>
          <h1>{cleanUrl(siteUrl)}</h1>
          <a href={gscUrl} target="_blank" rel="noopener" className="gsc-link">Open in GSC</a>
          {gaUrl && <a href={gaUrl} target="_blank" rel="noopener" className="gsc-link">Open in GA</a>}
        </div>
        <div className="dash-controls">
          <div className="day-buttons">
            <DayButton days={days} setDays={setDays} value={7} />
            <DayButton days={days} setDays={setDays} value={28} />
            <DayButton days={days} setDays={setDays} value={90} />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <DetailContent
        prop={prop}
        siteUrl={siteUrl}
        days={days}
        gaData={gaData}
        gaLoading={gaLoading}
        gaMetric={gaMetric}
        setGaMetric={setGaMetric}
      />
    </div>
  )
}

let DetailContent = ({
  prop, siteUrl, days, gaData, gaLoading, gaMetric, setGaMetric,
}: {
  prop: PropertyData
  siteUrl: string
  days: number
  gaData: GaSessionsData | null
  gaLoading: boolean
  gaMetric: string | null
  setGaMetric: (m: string | null) => void
}) => {
  let daily = prop.daily
  let gscDates = useMemo(() => daily.map((r) => r.date), [daily])

  let showGa = gaMetric !== null
  let gaColor = useMemo(() => {
    let found = GA_METRICS.find(([k]) => k === gaMetric)
    return found ? found[2] : "var(--chart-teal)"
  }, [gaMetric])

  let extraGaDates = useMemo(() => {
    if (!gaData) return []
    let gscSet = new Set(gscDates)
    let lastGsc = gscDates[gscDates.length - 1] || ""
    return gaData.daily
      .filter(([d]) => !gscSet.has(d) && d > lastGsc)
      .map(([d]) => d)
      .sort()
  }, [gaData, gscDates])

  // Build merged chart data
  let chartData = useMemo(() => {
    let gaByDate = gaData ? new Map(gaData.daily) : new Map<string, number>()
    let rows = daily.map((r) => ({
      date: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
      ga: gaByDate.get(r.date) ?? undefined,
    }))
    for (let d of extraGaDates) {
      rows.push({
        date: d,
        clicks: undefined as any,
        impressions: undefined as any,
        ctr: undefined as any,
        position: undefined as any,
        ga: gaByDate.get(d) ?? undefined,
      })
    }
    return rows
  }, [daily, gaData, extraGaDates])

  let gaTotal = gaData?.total ?? null

  let stats: [string, string][] = [
    ["Clicks", formatNumber(prop.clicks)],
    ["Impressions", formatNumber(prop.impressions)],
    ["CTR", formatCtr(prop.ctr)],
    ["Avg Position", formatPosition(prop.position)],
  ]

  let gaLabel = GA_METRICS.find(([k]) => k === gaMetric)?.[1] ?? "GA"
  let gaStatValue = useMemo(() => {
    if (gaTotal === null) return "-"
    if (gaMetric === "bounceRate") {
      let count = gaData?.daily.length || 1
      return `${(gaTotal / count * 100).toFixed(1)}%`
    }
    if (gaMetric === "averageSessionDuration") {
      let count = gaData?.daily.length || 1
      return `${(gaTotal / count).toFixed(0)}s`
    }
    return formatNumber(gaTotal)
  }, [gaTotal, gaMetric, gaData])

  return (
    <>
      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <div key={label} className="stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-label">{gaLabel}</div>
          <div className="stat-value">{gaStatValue}</div>
        </div>
      </div>

      <DetailChart
        chartData={chartData}
        gaMetric={gaMetric}
        setGaMetric={setGaMetric}
        showGa={showGa}
        gaColor={gaColor}
        gaLoading={gaLoading}
      />

      <DimensionTabs siteUrl={siteUrl} days={days} />
    </>
  )
}

type ChartRow = {
  date: string
  clicks: number
  impressions: number
  ctr: number
  position: number
  ga?: number
}

let ChartTooltipContent = ({ active, payload, label, showClicks, showImpressions, showCtr, showPosition, showGa, gaMetric, gaColor }: any) => {
  if (!active || !payload?.length) return null
  let data: Record<string, number> = {}
  for (let p of payload) data[p.dataKey] = p.value

  let formatGaVal = (v: number) => {
    if (gaMetric === "bounceRate") return `${(v * 100).toFixed(1)}%`
    if (gaMetric === "averageSessionDuration") return `${v.toFixed(0)}s`
    return formatTipNumber(v)
  }

  return (
    <div className="chart-tooltip chart-tooltip-inline">
      <div className="tooltip-date">{label}</div>
      {showClicks && data.clicks !== undefined && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "var(--green)" }} />
          <span className="tooltip-label">Clicks</span>
          <span className="tooltip-val">{formatTipNumber(data.clicks)}</span>
        </div>
      )}
      {showImpressions && data.impressions !== undefined && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "var(--accent)" }} />
          <span className="tooltip-label">Impressions</span>
          <span className="tooltip-val">{formatTipNumber(data.impressions)}</span>
        </div>
      )}
      {showCtr && data.ctr !== undefined && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "var(--chart-orange)" }} />
          <span className="tooltip-label">CTR</span>
          <span className="tooltip-val">{formatCtr(data.ctr)}</span>
        </div>
      )}
      {showPosition && data.position !== undefined && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: "var(--chart-purple)" }} />
          <span className="tooltip-label">Position</span>
          <span className="tooltip-val">{formatPosition(data.position)}</span>
        </div>
      )}
      {showGa && data.ga !== undefined && (
        <div className="tooltip-row">
          <span className="tooltip-dot" style={{ background: gaColor }} />
          <span className="tooltip-label">{GA_METRICS.find(([k]) => k === gaMetric)?.[1] ?? "GA"}</span>
          <span className="tooltip-val">{formatGaVal(data.ga)}</span>
        </div>
      )}
    </div>
  )
}

let DetailChart = ({
  chartData, gaMetric, setGaMetric, showGa, gaColor, gaLoading,
}: {
  chartData: ChartRow[]
  gaMetric: string | null
  setGaMetric: (m: string | null) => void
  showGa: boolean
  gaColor: string
  gaLoading: boolean
}) => {
  let [showClicks, setShowClicks] = useState(true)
  let [showImpressions, setShowImpressions] = useState(true)
  let [showCtr, setShowCtr] = useState(false)
  let [showPosition, setShowPosition] = useState(false)

  let gaLabel = useMemo(() => GA_METRICS.find(([k]) => k === gaMetric)?.[1] ?? "GA", [gaMetric])

  // Determine which metrics get the visible left/right ruler axes
  // Priority for left: clicks > impressions
  // Priority for right: impressions (if clicks takes left) > ga
  // When clicks is off and ga is on, impressions moves to left, ga takes right
  let leftMetric = showClicks ? "clicks" as const
    : showImpressions ? "impressions" as const
    : null
  let rightMetric = leftMetric === "clicks" && showImpressions ? "impressions" as const
    : leftMetric === "clicks" && showGa ? "ga" as const
    : leftMetric === "impressions" && showGa ? "ga" as const
    : leftMetric !== "impressions" && showImpressions ? "impressions" as const
    : null

  let axisColor = (m: "clicks" | "impressions" | "ga") =>
    m === "clicks" ? "var(--green)" : m === "impressions" ? "var(--accent)" : gaColor
  let axisLabel = (m: "clicks" | "impressions" | "ga") =>
    m === "clicks" ? "Clicks" : m === "impressions" ? "Impressions" : gaLabel

  return (
    <div className="chart-card">
      <div className="chart-toggles-row">
        <div className="chart-toggles">
          <MetricToggle label="Clicks" color="var(--green)" active={showClicks} setActive={setShowClicks} />
          <MetricToggle label="Impressions" color="var(--accent)" active={showImpressions} setActive={setShowImpressions} />
          <MetricToggle label="CTR" color="var(--chart-orange)" active={showCtr} setActive={setShowCtr} />
          <MetricToggle label="Position" color="var(--chart-purple)" active={showPosition} setActive={setShowPosition} />
        </div>
        <div className="chart-toggles ga-toggles">
          {gaLoading && <div className="ga-spinner" />}
          {GA_METRICS.map(([key, label, color]) => (
            <button
              key={key}
              className={`metric-toggle${gaMetric === key ? " metric-toggle-active" : ""}`}
              style={{
                borderColor: color,
                backgroundColor: gaMetric === key ? color : "transparent",
              }}
              onClick={() => setGaMetric(gaMetric === key ? null : key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-axis-labels">
        {leftMetric && <span className="axis-title" style={{ color: axisColor(leftMetric) }}>{axisLabel(leftMetric)}</span>}
        <span className="axis-title-spacer" />
        {rightMetric && <span className="axis-title" style={{ color: axisColor(rightMetric) }}>{axisLabel(rightMetric)}</span>}
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 50, bottom: 0, left: 50 }}>
            <defs>
              <linearGradient id="grad-clicks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--green)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-impressions" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="grad-ga" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gaColor} stopOpacity={0.15} />
                <stop offset="100%" stopColor={gaColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.3} horizontal vertical={false} />
            <XAxis dataKey="date" hide />

            <YAxis
              yAxisId="clicks"
              orientation={leftMetric === "clicks" ? "left" : "right"}
              hide={!showClicks || (leftMetric !== "clicks" && rightMetric !== "clicks")}
              tick={{ fill: "var(--green)", fontSize: 9, fontFamily: "var(--mono)" }}
              tickFormatter={formatAxisNumber}
              width={44}
              domain={[0, "dataMax"]}
              allowDataOverflow
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              yAxisId="impressions"
              orientation={leftMetric === "impressions" ? "left" : "right"}
              hide={!showImpressions || (leftMetric !== "impressions" && rightMetric !== "impressions")}
              tick={{ fill: "var(--accent)", fontSize: 9, fontFamily: "var(--mono)" }}
              tickFormatter={formatAxisNumber}
              width={44}
              domain={[0, "dataMax"]}
              allowDataOverflow
              axisLine={false}
              tickLine={false}
            />

            <YAxis yAxisId="ctr" hide domain={[0, "dataMax"]} />
            <YAxis yAxisId="position" hide reversed domain={[0, "dataMax"]} />
            <YAxis
              yAxisId="ga"
              orientation={leftMetric === "ga" ? "left" : "right"}
              hide={!showGa || (leftMetric !== "ga" && rightMetric !== "ga")}
              tick={{ fill: gaColor, fontSize: 9, fontFamily: "var(--mono)" }}
              tickFormatter={formatAxisNumber}
              width={44}
              domain={[0, "dataMax"]}
              allowDataOverflow
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              content={
                <ChartTooltipContent
                  showClicks={showClicks}
                  showImpressions={showImpressions}
                  showCtr={showCtr}
                  showPosition={showPosition}
                  showGa={showGa}
                  gaMetric={gaMetric}
                  gaColor={gaColor}
                />
              }
              cursor={{ stroke: "var(--text-muted)", strokeWidth: 1, opacity: 0.5 }}
            />

            {showClicks && (
              <Area
                yAxisId="clicks"
                type="monotone"
                dataKey="clicks"
                fill="url(#grad-clicks)"
                stroke="none"
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showClicks && (
              <Line
                yAxisId="clicks"
                type="monotone"
                dataKey="clicks"
                stroke="var(--green)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props: any) => {
                  if (props.index !== chartData.length - 1 || props.value === undefined) return <circle key="empty" r={0} />
                  return <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill="var(--green)" stroke="var(--surface)" strokeWidth={2} />
                }}
                activeDot={{ r: 4, fill: "var(--green)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showImpressions && (
              <Area
                yAxisId="impressions"
                type="monotone"
                dataKey="impressions"
                fill="url(#grad-impressions)"
                stroke="none"
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showImpressions && (
              <Line
                yAxisId="impressions"
                type="monotone"
                dataKey="impressions"
                stroke="var(--accent)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props: any) => {
                  if (props.index !== chartData.length - 1 || props.value === undefined) return <circle key="empty" r={0} />
                  return <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                }}
                activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showCtr && (
              <Line
                yAxisId="ctr"
                type="monotone"
                dataKey="ctr"
                stroke="var(--chart-orange)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props: any) => {
                  if (props.index !== chartData.length - 1 || props.value === undefined) return <circle key="empty" r={0} />
                  return <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill="var(--chart-orange)" stroke="var(--surface)" strokeWidth={2} />
                }}
                activeDot={{ r: 4, fill: "var(--chart-orange)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showPosition && (
              <Line
                yAxisId="position"
                type="monotone"
                dataKey="position"
                stroke="var(--chart-purple)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props: any) => {
                  if (props.index !== chartData.length - 1 || props.value === undefined) return <circle key="empty" r={0} />
                  return <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill="var(--chart-purple)" stroke="var(--surface)" strokeWidth={2} />
                }}
                activeDot={{ r: 4, fill: "var(--chart-purple)", stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showGa && (
              <Area
                yAxisId="ga"
                type="monotone"
                dataKey="ga"
                fill="url(#grad-ga)"
                stroke="none"
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
            {showGa && (
              <Line
                yAxisId="ga"
                type="monotone"
                dataKey="ga"
                stroke={gaColor}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={(props: any) => {
                  if (props.index !== chartData.length - 1 || props.value === undefined) return <circle key="empty" r={0} />
                  return <circle key="end" cx={props.cx} cy={props.cy} r={3.5} fill={gaColor} stroke="var(--surface)" strokeWidth={2} />
                }}
                activeDot={{ r: 4, fill: gaColor, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

let MetricToggle = ({ label, color, active, setActive }: { label: string; color: string; active: boolean; setActive: (v: boolean) => void }) => (
  <button
    className={`metric-toggle${active ? " metric-toggle-active" : ""}`}
    style={{ borderColor: color, backgroundColor: active ? color : "transparent" }}
    onClick={() => setActive(!active)}
  >
    {label}
  </button>
)

let DIMENSION_TABS: [string, string][] = [
  ["query", "Queries"],
  ["page", "Pages"],
  ["country", "Countries"],
  ["device", "Devices"],
]

let DimensionTabs = ({ siteUrl, days }: { siteUrl: string; days: number }) => {
  let [activeTab, setActiveTab] = useState("query")
  let [rows, setRows] = useState<DimensionRow[]>([])
  let [loading, setLoading] = useState(true)
  let cacheRef = useRef<Record<string, DimensionRow[]>>({})

  useEffect(() => {
    let key = `${siteUrl}:${activeTab}:${days}`
    if (cacheRef.current[key]) {
      setRows(cacheRef.current[key])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchDimension(siteUrl, activeTab, days)
      .then((result) => {
        if (cancelled) return
        cacheRef.current[key] = result
        setRows(result)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [siteUrl, activeTab, days])

  let colLabel = activeTab === "query" ? "Query" : activeTab === "page" ? "Page" : activeTab === "country" ? "Country" : activeTab === "device" ? "Device" : "Key"

  return (
    <div className="chart-card">
      <div className="dim-tabs">
        {DIMENSION_TABS.map(([key, label]) => (
          <button
            key={key}
            className={`dim-tab${activeTab === key ? " dim-tab-active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <div className="table-card">
          <table className="prop-table">
            <thead>
              <tr>
                <th>{colLabel}</th>
                <th className="num-cell">Clicks</th>
                <th className="num-cell">Impressions</th>
                <th className="num-cell">CTR</th>
                <th className="num-cell">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="prop-name dim-key">{row.key}</td>
                  <td className="num-cell color-green">{formatNumber(row.clicks)}</td>
                  <td className="num-cell color-accent">{formatNumber(row.impressions)}</td>
                  <td className="num-cell">{formatCtr(row.ctr)}</td>
                  <td className="num-cell">{formatPosition(row.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
