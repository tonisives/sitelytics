import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Helmet } from "react-helmet-async"
import type { DashboardData, GaPropertyData } from "../types"
import { fetchGscData, fetchAllGaSessions, logout } from "../lib/api"
import { formatNumber, formatCtr, formatPosition, cleanUrl } from "../lib/format"
import { DayButton } from "../components/DayButton"
import { StatCard } from "../components/StatCard"
import { SparklineTooltip, OverlaySparklineTooltip } from "../components/Sparkline"

export let Dashboard = () => {
  let [days, setDays] = useState(28)
  let [data, setData] = useState<DashboardData | null>(null)
  let [error, setError] = useState<string | null>(null)
  let [loading, setLoading] = useState(true)
  let [gaMap, setGaMap] = useState<Record<string, GaPropertyData>>({})
  let [gaLoading, setGaLoading] = useState(false)
  let navigate = useNavigate()

  // Cache dashboard data per days
  let cacheRef = useRef<Record<number, DashboardData>>({})
  let gaCacheRef = useRef<Record<number, Record<string, GaPropertyData>>>({})

  useEffect(() => {
    let cancelled = false
    let load = async () => {
      if (cacheRef.current[days]) {
        setData(cacheRef.current[days])
        setLoading(false)
      } else {
        setLoading(true)
      }
      try {
        let result = await fetchGscData(days)
        if (cancelled) return
        cacheRef.current[days] = result
        setData(result)
        setError(null)
      } catch (e: any) {
        if (cancelled) return
        if (e.message?.includes("Not authenticated") || e.message?.includes("401")) {
          navigate("/login")
          return
        }
        setError(e.message || "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [days, navigate])

  // Fetch GA sessions after dashboard loads
  useEffect(() => {
    if (!data) return
    if (gaCacheRef.current[days]) {
      setGaMap(gaCacheRef.current[days])
      return
    }
    let urls = data.properties.map((p) => p.site_url)
    if (urls.length === 0) return
    let cancelled = false
    setGaLoading(true)
    fetchAllGaSessions(urls, days)
      .then((map) => {
        if (cancelled) return
        gaCacheRef.current[days] = map
        setGaMap(map)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setGaLoading(false) })
    return () => { cancelled = true }
  }, [data, days])

  let handleLogout = useCallback(async () => {
    await logout()
    window.location.href = "/"
  }, [])

  if (loading && !data) return <div className="loading">Loading...</div>
  if (error) return <div className="container"><div className="error-text">{error}</div></div>
  if (!data) return null

  let totalGaSessions = Object.values(gaMap).reduce((sum, d) => sum + d.total, 0)
  let hasGa = Object.keys(gaMap).length > 0
  let label = `Last ${days} days`

  return (
    <div className="container">
      <Helmet><title>Sitelytics</title></Helmet>
      <header className="dash-header">
        <h1>Sitelytics</h1>
        <div className="dash-controls">
          <div className="day-buttons">
            <DayButton days={days} setDays={setDays} value={7} />
            <DayButton days={days} setDays={setDays} value={28} />
            <DayButton days={days} setDays={setDays} value={90} />
          </div>
          <button className="logout-btn" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className="stats-grid">
        <StatCard label="Impressions" value={formatNumber(data.totals.impressions)} sub={label} />
        <StatCard label="Clicks" value={formatNumber(data.totals.clicks)} sub={label} />
        <StatCard label="CTR" value={formatCtr(data.totals.ctr)} />
        <StatCard label="Avg Position" value={formatPosition(data.totals.position)} />
        <div className="stat-card">
          <div className="stat-label">Sessions</div>
          <div className="stat-value">
            {gaLoading
              ? <div className="ga-spinner" />
              : <span>{hasGa ? formatNumber(totalGaSessions) : "-"}</span>
            }
          </div>
          <div className="stat-sub color-teal">Google Analytics</div>
        </div>
      </div>

      <h2>Properties ({data.properties.length})</h2>
      <PropertyTable properties={data.properties} gaMap={gaMap} />
    </div>
  )
}

let PropertyTable = ({ properties, gaMap }: { properties: DashboardData["properties"]; gaMap: Record<string, GaPropertyData> }) => (
  <div className="table-card">
    <table className="prop-table">
      <thead>
        <tr>
          <th>Property</th>
          <th className="num-cell">Impressions</th>
          <th className="num-cell">Clicks</th>
          <th className="num-cell">CTR</th>
          <th className="num-cell">Position</th>
          <th className="num-cell ga-col">Sessions</th>
          <th className="sparkline-header">Clicks / Impressions</th>
          <th className="sparkline-header ga-col">Sessions</th>
        </tr>
      </thead>
      <tbody>
        {properties.map((p) => (
          <PropertyRow key={p.site_url} property={p} gaData={gaMap[p.site_url]} />
        ))}
      </tbody>
    </table>
  </div>
)

let PropertyRow = ({ property, gaData }: { property: DashboardData["properties"][0]; gaData?: GaPropertyData }) => {
  let href = `/property/${encodeURIComponent(property.site_url)}`

  let overlayData = useMemo(
    () => property.daily.map((r) => [r.date, r.clicks, r.impressions] as [string, number, number]),
    [property.daily],
  )
  let dates = useMemo(() => property.daily.map((r) => r.date), [property.daily])

  let gaSparkData = useMemo(
    () => gaData ? dates.map((d, i) => [d, gaData.daily[i] ?? 0] as [string, number]) : [],
    [dates, gaData],
  )

  return (
    <tr className="prop-row-link">
      <td className="prop-name"><a href={href} className="row-link">{cleanUrl(property.site_url)}</a></td>
      <td className="num-cell"><a href={href} className="row-link">{formatNumber(property.impressions)}</a></td>
      <td className="num-cell"><a href={href} className="row-link">{formatNumber(property.clicks)}</a></td>
      <td className="num-cell"><a href={href} className="row-link">{formatCtr(property.ctr)}</a></td>
      <td className="num-cell"><a href={href} className="row-link">{formatPosition(property.position)}</a></td>
      <td className="num-cell ga-col">
        <a href={href} className="row-link color-teal">
          {gaData ? formatNumber(gaData.total) : "-"}
        </a>
      </td>
      <td className="sparkline-cell">
        <OverlaySparklineTooltip
          href={href}
          colorA="var(--green)"
          colorB="var(--accent)"
          data={overlayData}
          labelA="Clicks"
          labelB="Impressions"
        />
      </td>
      <td className="sparkline-cell">
        {gaData && gaSparkData.length > 0 ? (
          <SparklineTooltip
            href={href}
            color="var(--chart-teal)"
            data={gaSparkData}
            label="Sessions"
          />
        ) : (
          <a href={href} className="row-link"><span /></a>
        )}
      </td>
    </tr>
  )
}
