import { useEffect,useState } from "react"
import { Helmet } from "react-helmet-async"
import type { AdminUsage as Usage } from "../types"
import { fetchAdminUsage } from "../lib/api"

export let AdminUsage = () => {
  let [usage,setUsage]=useState<Usage|null>(null)
  let [error,setError]=useState<string|null>(null)
  useEffect(()=>{fetchAdminUsage().then(setUsage).catch((value)=>setError(value.message))},[])
  if(error)return <div className="container"><p className="error-text">{error}</p></div>
  if(!usage)return <div className="loading">Loading...</div>
  let cards:[string,string|number][]=[["Users",usage.users],["Active sessions",usage.active_sessions],["Signups · 7d",usage.signups_7d],["AEO users",usage.active_aeo_users],["Active queries",usage.active_queries],["Queue backlog",usage.backlog],["Samples · 7d",usage.samples_7d],["Coverage · 7d",usage.samples_7d?`${Math.round(usage.success_7d/usage.samples_7d*100)}%`:"-"],["Blocked · 7d",usage.blocked_7d],["Avg latency",usage.average_latency_ms?`${Math.round(usage.average_latency_ms/1000)}s`:"-"]]
  return <div className="container"><Helmet><title>Usage - Sitelytics</title></Helmet><header className="dash-header"><div className="detail-title-row"><a href="/" className="back-link">&lt; Back</a><h1>Usage</h1></div></header><div className="stats-grid">{cards.map(([label,value])=><div className="stat-card" key={label}><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>)}</div><h2>Provider health</h2><div className="table-card"><table className="prop-table"><thead><tr><th>Provider</th><th>Last success</th><th>Failures</th><th>Circuit</th><th>Last error</th></tr></thead><tbody>{usage.providers.map((provider)=><tr key={provider.provider}><td>{provider.provider}</td><td>{provider.last_success_at?new Date(provider.last_success_at).toLocaleString():"-"}</td><td>{provider.consecutive_failures}</td><td>{provider.circuit_open_until?new Date(provider.circuit_open_until).toLocaleString():"closed"}</td><td>{provider.last_error_code||"-"}</td></tr>)}</tbody></table></div><h2 className="admin-section-title">Recent failures</h2><div className="table-card"><table className="prop-table"><thead><tr><th>Provider</th><th>Prompt</th><th>Error</th><th>Time</th></tr></thead><tbody>{usage.recent_failures.map((failure,index)=><tr key={`${failure.provider}-${failure.completed_at}-${index}`}><td>{failure.provider}</td><td>{failure.prompt}</td><td>{failure.error_code||"failed"}</td><td>{failure.completed_at?new Date(failure.completed_at).toLocaleString():"-"}</td></tr>)}</tbody></table></div></div>
}
