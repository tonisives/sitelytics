import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { Helmet } from "react-helmet-async"
import type { DashboardData, GaPropertyData } from "../types"
import type { AeoDashboardRow } from "../types"
import { fetchGscData, fetchAllGaSessions, fetchAeoDashboard, fetchMe, logout } from "../lib/api"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { formatNumber, formatCtr, formatPosition, cleanUrl } from "../lib/format"
import { DayButton } from "../components/DayButton"
import { StatCard } from "../components/StatCard"
import { SparklineTooltip, OverlaySparklineTooltip } from "../components/Sparkline"
import { ThemeToggle } from "../components/ThemeToggle"

export let Dashboard = () => {
  let [days, setDays] = useState(28)
  let [data, setData] = useState<DashboardData | null>(null)
  let [error, setError] = useState<string | null>(null)
  let [loading, setLoading] = useState(true)
  let [gaMap, setGaMap] = useState<Record<string, GaPropertyData>>({})
  let [gaLoading, setGaLoading] = useState(false)
  let [normalized, setNormalized] = useState(false)
  let [aeoMap, setAeoMap] = useState<Record<string,AeoDashboardRow>>({})
  let [isAdmin,setIsAdmin] = useState(false)
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

  useEffect(() => {
    if (!data) return
    let urls=data.properties.map((property)=>property.site_url)
    fetchAeoDashboard(urls).then((rows)=>setAeoMap(Object.fromEntries(rows.map((row)=>[row.site_url,row])))).catch(()=>{})
    fetchMe().then((user)=>setIsAdmin(user.is_admin)).catch(()=>{})
  },[data])

  let handleLogout = useCallback(async () => {
    await logout()
    window.location.href = "/"
  }, [])

  let globalMax = useMemo(() => {
    if (!normalized || !data) return undefined
    let maxClicks = Math.max(0, ...data.properties.map((p) => Math.max(0, ...p.daily.map((r) => r.clicks))))
    let maxImpressions = Math.max(0, ...data.properties.map((p) => Math.max(0, ...p.daily.map((r) => r.impressions))))
    let maxSessions = Math.max(0, ...Object.values(gaMap).flatMap((g) => g.daily))
    return { clicks: maxClicks, impressions: maxImpressions, sessions: maxSessions }
  }, [normalized, data, gaMap])

  let globalDates = useMemo(() => {
    if (!normalized) return undefined
    let dates: string[] = []
    let d = new Date()
    for (let i = days - 1; i >= 0; i--) {
      let dt = new Date(d)
      dt.setDate(d.getDate() - i)
      dates.push(dt.toISOString().slice(0, 10))
    }
    return dates
  }, [normalized, days])

  if (loading && !data) return <div className="loading">Loading...</div>
  if (error) return <div className="container"><div className="error-text">{error}</div></div>
  if (!data) return null

  let totalGaSessions = Object.values(gaMap).reduce((sum, d) => sum + d.total, 0)
  let hasGa = Object.keys(gaMap).length > 0
  let label = `Last ${days} days`
  let aeoKnown=Object.values(aeoMap).reduce((sum,row)=>sum+row.known,0)
  let aeoMentioned=Object.values(aeoMap).reduce((sum,row)=>sum+row.mentioned,0)

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
          <ThemeToggle />
          {isAdmin&&<a className="logout-btn admin-link" href="/admin/usage">Usage</a>}
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
        <div className="stat-card">
          <div className="stat-label">AI visibility</div>
          <div className="stat-value">{aeoKnown?`${Math.round(aeoMentioned/aeoKnown*100)}%`:"-"}</div>
          <div className="stat-sub color-accent">Discovery queries mentioned</div>
        </div>
      </div>

      <div className="table-header-row">
        <h2>Properties ({data.properties.length})</h2>
        <button
          className={`toggle-btn${normalized ? " active" : ""}`}
          onClick={() => setNormalized((n) => !n)}
          title="Scale all sparklines to the same axis"
        >Scale</button>
      </div>
      <PropertyTable properties={data.properties} gaMap={gaMap} aeoMap={aeoMap} globalMax={globalMax} globalDates={globalDates} />
    </div>
  )
}

type GlobalMax = { clicks: number; impressions: number; sessions: number }

let PropertyTable = ({ properties, gaMap, aeoMap, globalMax, globalDates }: { properties: DashboardData["properties"]; gaMap: Record<string, GaPropertyData>; aeoMap:Record<string,AeoDashboardRow>; globalMax?: GlobalMax; globalDates?: string[] }) => (
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
          <th className="num-cell">AI mentions</th>
          <th className="sparkline-header">Clicks / Impressions</th>
          <th className="sparkline-header ga-col">Sessions</th>
        </tr>
      </thead>
      <tbody>
        {properties.map((p) => (
          <PropertyRow key={p.site_url} property={p} gaData={gaMap[p.site_url]} aeoData={aeoMap[p.site_url]} globalMax={globalMax} globalDates={globalDates} />
        ))}
      </tbody>
    </table>
  </div>
)

let PropertyRow = ({ property, gaData, aeoData, globalMax, globalDates }: { property: DashboardData["properties"][0]; gaData?: GaPropertyData; aeoData?:AeoDashboardRow; globalMax?: GlobalMax; globalDates?: string[] }) => {
  let href = `/property/${encodeURIComponent(property.site_url)}`

  let overlayData = useMemo(() => {
    let byDate = new Map(property.daily.map((r) => [r.date, r]))
    let datesToUse = globalDates ?? property.daily.map((r) => r.date)
    return datesToUse.map((d) => {
      let r = byDate.get(d)
      return [d, r?.clicks ?? 0, r?.impressions ?? 0] as [string, number, number]
    })
  }, [property.daily, globalDates])

  let dates = useMemo(() => globalDates ?? property.daily.map((r) => r.date), [property.daily, globalDates])

  let gaSparkData = useMemo(() => {
    if (!gaData) return []
    let byDate = new Map(gaData.daily_dated)
    let allDates = globalDates
      ? new Set([...globalDates])
      : new Set([...dates, ...gaData.daily_dated.map(([d]) => d)])
    return [...allDates].sort().map((d) => [d, byDate.get(d) ?? 0] as [string, number])
  }, [dates, gaData, globalDates])

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
      <td className="aeo-pie-cell"><AeoPie data={aeoData} href={href} /></td>
      <td className="sparkline-cell">
        <OverlaySparklineTooltip
          href={href}
          colorA="var(--green)"
          colorB="var(--accent)"
          data={overlayData}
          labelA="Clicks"
          labelB="Impressions"
          globalMaxA={globalMax?.clicks}
          globalMaxB={globalMax?.impressions}
        />
      </td>
      <td className="sparkline-cell">
        {gaData && gaSparkData.length > 0 ? (
          <SparklineTooltip
            href={href}
            color="var(--chart-teal)"
            data={gaSparkData}
            label="Sessions"
            globalMax={globalMax?.sessions}
          />
        ) : (
          <a href={href} className="row-link"><span /></a>
        )}
      </td>
    </tr>
  )
}

let AeoPie = ({data,href}:{data?:AeoDashboardRow;href:string}) => {
  if (!data || (!data.known&&!data.unknown)) return <a href={href} className="row-link">-</a>
  let absent=Math.max(0,data.known-data.mentioned)
  let chart=[{name:"Mentioned",value:data.mentioned,color:"var(--accent)"},{name:"Not mentioned",value:absent,color:"var(--border)"},{name:"Unknown",value:data.unknown,color:"var(--chart-orange)"}].filter((item)=>item.value>0)
  return <a href={href} className="aeo-pie-link" title={`${data.mentioned}/${data.known} known pairs mentioned; ${data.unknown} unknown`}><ResponsiveContainer width={42} height={42}><PieChart><Pie data={chart} dataKey="value" innerRadius={11} outerRadius={19} stroke="none">{chart.map((item)=><Cell key={item.name} fill={item.color}/>)}</Pie></PieChart></ResponsiveContainer><span>{data.mentioned}/{data.known}</span></a>
}
