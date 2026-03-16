import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Helmet } from "react-helmet-async"
import type { PropertyData, DailyRow, DimensionRow, GaSessionsData } from "../types"
import { fetchPropertyDetail, fetchGaSessions, fetchDimension } from "../lib/api"
import { formatNumber, formatTipNumber, formatCtr, formatPosition, formatAxisNumber, cleanUrl } from "../lib/format"
import { buildScaledChartPath } from "../lib/chart"
import { DayButton } from "../components/DayButton"

let GA_METRICS: [string, string, string][] = [
  ["sessions", "Sessions", "var(--chart-teal)"],
  ["screenPageViews", "Pageviews", "var(--chart-pink)"],
  ["engagedSessions", "Engaged", "var(--chart-teal)"],
  ["bounceRate", "Bounce Rate", "var(--chart-pink)"],
  ["averageSessionDuration", "Avg Duration", "var(--chart-teal)"],
]

type MetricKey = "clicks" | "impressions" | "ctr" | "position"

let METRICS: { key: MetricKey; color: string; accessor: (r: DailyRow) => number }[] = [
  { key: "clicks", color: "var(--green)", accessor: (r) => r.clicks },
  { key: "impressions", color: "var(--accent)", accessor: (r) => r.impressions },
  { key: "ctr", color: "var(--chart-orange)", accessor: (r) => r.ctr },
  { key: "position", color: "var(--chart-purple)", accessor: (r) => r.position },
]

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

  // Fetch GA data when metric changes
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
        <div className="day-buttons">
          <DayButton days={days} setDays={setDays} value={7} />
          <DayButton days={days} setDays={setDays} value={28} />
          <DayButton days={days} setDays={setDays} value={90} />
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
  let gscDateCount = gscDates.length

  let showGa = gaMetric !== null
  let gaColor = useMemo(() => {
    let found = GA_METRICS.find(([k]) => k === gaMetric)
    return found ? found[2] : "var(--chart-teal)"
  }, [gaMetric])

  // Extra GA dates beyond GSC range
  let extraGaDates = useMemo(() => {
    if (!gaData) return []
    let gscSet = new Set(gscDates)
    let lastGsc = gscDates[gscDates.length - 1] || ""
    return gaData.daily
      .filter(([d]) => !gscSet.has(d) && d > lastGsc)
      .map(([d]) => d)
      .sort()
  }, [gaData, gscDates])

  let numDays = showGa ? gscDateCount + extraGaDates.length : gscDateCount

  // Pre-compute chart lines
  let lines = useMemo(() => METRICS.map((m) => {
    let values = daily.map(m.accessor)
    let maxVal = Math.max(...values, 0)
    let safeMax = maxVal === 0 ? 1 : maxVal
    let yPcts = values.map((v) => v / safeMax * 0.9 + 0.05)
    return { key: m.key, color: m.color, maxVal, yPcts }
  }), [daily])

  let gscPaths = useMemo(() => lines.map((l) => buildScaledChartPath(l.yPcts, numDays)), [lines, numDays])

  let clicksMax = lines.find((l) => l.key === "clicks")?.maxVal ?? 0
  let impressionsMax = lines.find((l) => l.key === "impressions")?.maxVal ?? 0

  // GA chart line
  let gaChart = useMemo(() => {
    if (!gaData) return null
    let gaByDate = new Map(gaData.daily)
    let values = gscDates.map((d) => gaByDate.get(d) ?? 0)
    for (let d of extraGaDates) values.push(gaByDate.get(d) ?? 0)
    let maxVal = Math.max(...values, 0)
    let safeMax = maxVal === 0 ? 1 : maxVal
    let yPcts = values.map((v) => v / safeMax * 0.9 + 0.05)
    let path = buildScaledChartPath(yPcts, values.length)
    return { path, maxVal, yPcts, values }
  }, [gaData, gscDates, extraGaDates])

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

  let [hoverIdx, setHoverIdx] = useState<number | null>(null)

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
        lines={lines}
        gscPaths={gscPaths}
        gscLineCount={gscDateCount}
        numDays={numDays}
        gaChart={gaChart}
        gaMetric={gaMetric}
        setGaMetric={setGaMetric}
        showGa={showGa}
        gaColor={gaColor}
        gaLoading={gaLoading}
        clicksMax={clicksMax}
        impressionsMax={impressionsMax}
        gscDateCount={gscDateCount}
        extraGaDates={extraGaDates}
        daily={daily}
        hoverIdx={hoverIdx}
        setHoverIdx={setHoverIdx}
      />

      <DimensionTabs siteUrl={siteUrl} days={days} />
    </>
  )
}

type ChartLine = { key: MetricKey; color: string; maxVal: number; yPcts: number[] }
type GaChartData = { path: string; maxVal: number; yPcts: number[]; values: number[] }

let DetailChart = ({
  lines, gscPaths, gscLineCount, numDays, gaChart,
  gaMetric, setGaMetric, showGa, gaColor, gaLoading,
  clicksMax, impressionsMax, gscDateCount, extraGaDates, daily,
  hoverIdx, setHoverIdx,
}: {
  lines: ChartLine[]
  gscPaths: string[]
  gscLineCount: number
  numDays: number
  gaChart: GaChartData | null
  gaMetric: string | null
  setGaMetric: (m: string | null) => void
  showGa: boolean
  gaColor: string
  gaLoading: boolean
  clicksMax: number
  impressionsMax: number
  gscDateCount: number
  extraGaDates: string[]
  daily: DailyRow[]
  hoverIdx: number | null
  setHoverIdx: (idx: number | null) => void
}) => {
  let [showClicks, setShowClicks] = useState(true)
  let [showImpressions, setShowImpressions] = useState(true)
  let [showCtr, setShowCtr] = useState(false)
  let [showPosition, setShowPosition] = useState(false)

  let chartRef = useRef<HTMLDivElement>(null)

  let handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    let el = chartRef.current
    if (!el) return
    let x = e.nativeEvent.offsetX
    let w = el.offsetWidth
    if (w <= 0 || numDays === 0) { setHoverIdx(null); return }
    let ratio = Math.min(1, Math.max(0, x / w))
    let idx = Math.min(numDays - 1, Math.round(ratio * (numDays - 1)))
    setHoverIdx(idx)
  }, [numDays, setHoverIdx])

  let handleMouseLeave = useCallback(() => setHoverIdx(null), [setHoverIdx])

  let crosshairPct = hoverIdx !== null && numDays > 1
    ? hoverIdx / (numDays - 1) * 100
    : null

  let tooltipContent = useMemo(() => {
    if (hoverIdx === null) return null
    if (hoverIdx < gscDateCount) {
      let row = daily[hoverIdx]
      if (!row) return null
      return { date: row.date, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
    }
    let extraIdx = hoverIdx - gscDateCount
    let date = extraGaDates[extraIdx]
    if (!date) return null
    return { date, clicks: null as number | null, impressions: null as number | null, ctr: null as number | null, position: null as number | null }
  }, [hoverIdx, gscDateCount, daily, extraGaDates])

  let isVisible = (key: MetricKey) => {
    if (key === "clicks") return showClicks
    if (key === "impressions") return showImpressions
    if (key === "ctr") return showCtr
    if (key === "position") return showPosition
    return false
  }

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

      {/* Axis labels */}
      <div className="chart-axis-labels">
        <span className="axis-title color-green" style={{ display: showClicks ? "block" : "none" }}>Clicks</span>
        <span className="axis-title-spacer" />
        <span className="axis-title color-accent" style={{ display: showImpressions ? "block" : "none" }}>Impressions</span>
      </div>

      <div className="chart-container">
        {/* Left axis */}
        <div className="chart-axis chart-axis-left" style={{ visibility: showClicks ? "visible" : "hidden" }}>
          <span className="axis-label color-green">{formatAxisNumber(clicksMax)}</span>
          <span className="axis-label color-green">{formatAxisNumber(clicksMax / 2)}</span>
          <span className="axis-label color-green">0</span>
        </div>

        {/* Chart area */}
        <div
          className="chart-area"
          ref={chartRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <svg className="full-chart" viewBox="0 0 800 200" preserveAspectRatio="none">
            <line x1="0" y1="10" x2="800" y2="10" stroke="var(--border)" strokeWidth="0.5" style={{ vectorEffect: "non-scaling-stroke" }} />
            <line x1="0" y1="100" x2="800" y2="100" stroke="var(--border)" strokeWidth="0.5" style={{ vectorEffect: "non-scaling-stroke" }} />
            <line x1="0" y1="190" x2="800" y2="190" stroke="var(--border)" strokeWidth="0.5" style={{ vectorEffect: "non-scaling-stroke" }} />

            {lines.map((line, i) => {
              let visible = isVisible(line.key)
              let fillClose = (() => {
                let n = line.yPcts.length
                let lastX = numDays > 1 && n > 0 ? (n - 1) / (numDays - 1) * 800 : 0
                return `${gscPaths[i]} L${lastX.toFixed(1)},200 L0,200 Z`
              })()
              return (
                <g key={line.key} style={{ display: visible ? "block" : "none" }}>
                  <path d={fillClose} fill={line.color} opacity="0.08" />
                  <path d={gscPaths[i]} fill="none" stroke={line.color} strokeWidth="2" style={{ vectorEffect: "non-scaling-stroke" }} />
                </g>
              )
            })}

            {showGa && gaChart && (
              <g>
                <path d={`${gaChart.path} L800,200 L0,200 Z`} fill={gaColor} opacity="0.08" />
                <path d={gaChart.path} fill="none" stroke={gaColor} strokeWidth="2" style={{ vectorEffect: "non-scaling-stroke" }} />
              </g>
            )}
          </svg>

          {/* Crosshair */}
          {crosshairPct !== null && (
            <div className="chart-crosshair" style={{ left: `${crosshairPct}%` }} />
          )}

          {/* GSC dots */}
          {lines.map((line) => {
            let visible = isVisible(line.key)
            let inRange = hoverIdx !== null && hoverIdx < gscLineCount
            let y = hoverIdx !== null ? (line.yPcts[hoverIdx] ?? 0.5) : 0.5
            return (
              <div
                key={line.key}
                className="chart-dot"
                style={{
                  display: inRange && visible ? "block" : "none",
                  left: crosshairPct !== null ? `${crosshairPct}%` : "0%",
                  top: `${(1 - y) * 100}%`,
                  background: line.color,
                }}
              />
            )
          })}

          {/* GA dot */}
          {showGa && gaChart && hoverIdx !== null && (
            <div
              className="chart-dot"
              style={{
                display: "block",
                left: crosshairPct !== null ? `${crosshairPct}%` : "0%",
                top: `${(1 - (gaChart.yPcts[hoverIdx] ?? 0.5)) * 100}%`,
                background: gaColor,
              }}
            />
          )}

          {/* Tooltip */}
          {tooltipContent && crosshairPct !== null && (
            <div
              className={`chart-tooltip${crosshairPct > 70 ? " tooltip-right" : ""}`}
              style={{ left: `${crosshairPct}%` }}
            >
              <div className="tooltip-date">{tooltipContent.date}</div>
              {showClicks && tooltipContent.clicks !== null && (
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--green)" }} />
                  <span className="tooltip-label">Clicks</span>
                  <span className="tooltip-val">{formatTipNumber(tooltipContent.clicks)}</span>
                </div>
              )}
              {showImpressions && tooltipContent.impressions !== null && (
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--accent)" }} />
                  <span className="tooltip-label">Impressions</span>
                  <span className="tooltip-val">{formatTipNumber(tooltipContent.impressions)}</span>
                </div>
              )}
              {showCtr && tooltipContent.ctr !== null && (
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--chart-orange)" }} />
                  <span className="tooltip-label">CTR</span>
                  <span className="tooltip-val">{formatCtr(tooltipContent.ctr)}</span>
                </div>
              )}
              {showPosition && tooltipContent.position !== null && (
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: "var(--chart-purple)" }} />
                  <span className="tooltip-label">Position</span>
                  <span className="tooltip-val">{formatPosition(tooltipContent.position)}</span>
                </div>
              )}
              {showGa && gaChart && (
                <div className="tooltip-row">
                  <span className="tooltip-dot" style={{ background: gaColor }} />
                  <span className="tooltip-label">{GA_METRICS.find(([k]) => k === gaMetric)?.[1] ?? "GA"}</span>
                  <span className="tooltip-val">
                    {(() => {
                      let v = gaChart.values[hoverIdx ?? 0]
                      if (v === undefined) return ""
                      if (gaMetric === "bounceRate") return `${(v * 100).toFixed(1)}%`
                      if (gaMetric === "averageSessionDuration") return `${v.toFixed(0)}s`
                      return formatTipNumber(v)
                    })()}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right axis */}
        <div className="chart-axis chart-axis-right" style={{ visibility: showImpressions ? "visible" : "hidden" }}>
          <span className="axis-label color-accent">{formatAxisNumber(impressionsMax)}</span>
          <span className="axis-label color-accent">{formatAxisNumber(impressionsMax / 2)}</span>
          <span className="axis-label color-accent">0</span>
        </div>
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
