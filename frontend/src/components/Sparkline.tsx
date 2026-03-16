import { useState, useCallback } from "react"
import { formatNumber } from "../lib/format"

export let SparklineTooltip = ({
  href, path, color, data, label,
}: {
  href: string
  path: string
  color: string
  data: [string, number][]
  label: string
}) => {
  let [hoverIdx, setHoverIdx] = useState<number | null>(null)
  let len = data.length

  let handleMouseMove = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (len === 0) return
    let rect = e.currentTarget.getBoundingClientRect()
    let x = e.clientX - rect.left
    let w = rect.width
    if (w <= 0) return
    let ratio = Math.min(1, Math.max(0, x / w))
    let idx = Math.min(len - 1, Math.round(ratio * (len - 1)))
    setHoverIdx(idx)
  }, [len])

  let handleMouseLeave = useCallback(() => setHoverIdx(null), [])

  let cursorX = hoverIdx !== null && len > 1
    ? (hoverIdx / (len - 1) * 80).toFixed(1)
    : "40.0"

  let tipPct = hoverIdx !== null && len > 1
    ? hoverIdx / (len - 1) * 100
    : 50

  let item = hoverIdx !== null ? data[hoverIdx] : null

  return (
    <a
      href={href}
      className="row-link sparkline-tooltip-wrap"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg className="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
        <line
          x1={cursorX} x2={cursorX} y1="0" y2="24"
          stroke="var(--text-muted)" strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
          style={{ opacity: hoverIdx !== null ? 0.5 : 0 }}
        />
      </svg>
      {item && (
        <div
          className={`sparkline-tip${tipPct > 50 ? " sparkline-tip-right" : ""}`}
          style={{ left: `${tipPct}%` }}
        >
          <div className="tooltip-date">{item[0]}</div>
          <div className="tooltip-row">
            <span className="tooltip-dot" style={{ background: color }} />
            <span className="tooltip-label">{label}</span>
            <span className="tooltip-val">{formatNumber(item[1])}</span>
          </div>
        </div>
      )}
    </a>
  )
}

export let OverlaySparklineTooltip = ({
  href, pathA, pathB, colorA, colorB, data, labelA, labelB,
}: {
  href: string
  pathA: string
  pathB: string
  colorA: string
  colorB: string
  data: [string, number, number][]
  labelA: string
  labelB: string
}) => {
  let [hoverIdx, setHoverIdx] = useState<number | null>(null)
  let len = data.length

  let handleMouseMove = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (len === 0) return
    let rect = e.currentTarget.getBoundingClientRect()
    let x = e.clientX - rect.left
    let w = rect.width
    if (w <= 0) return
    let ratio = Math.min(1, Math.max(0, x / w))
    let idx = Math.min(len - 1, Math.round(ratio * (len - 1)))
    setHoverIdx(idx)
  }, [len])

  let handleMouseLeave = useCallback(() => setHoverIdx(null), [])

  let cursorX = hoverIdx !== null && len > 1
    ? (hoverIdx / (len - 1) * 80).toFixed(1)
    : "40.0"

  let tipPct = hoverIdx !== null && len > 1
    ? hoverIdx / (len - 1) * 100
    : 50

  let item = hoverIdx !== null ? data[hoverIdx] : null

  return (
    <a
      href={href}
      className="row-link sparkline-tooltip-wrap"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg className="sparkline" viewBox="0 0 80 24" preserveAspectRatio="none">
        <path d={pathB} fill="none" stroke={colorB} strokeWidth="1.5" />
        <path d={pathA} fill="none" stroke={colorA} strokeWidth="1.5" />
        <line
          x1={cursorX} x2={cursorX} y1="0" y2="24"
          stroke="var(--text-muted)" strokeWidth="0.5"
          vectorEffect="non-scaling-stroke"
          style={{ opacity: hoverIdx !== null ? 0.5 : 0 }}
        />
      </svg>
      {item && (
        <div
          className={`sparkline-tip${tipPct > 50 ? " sparkline-tip-right" : ""}`}
          style={{ left: `${tipPct}%` }}
        >
          <div className="tooltip-date">{item[0]}</div>
          <div className="tooltip-row">
            <span className="tooltip-dot" style={{ background: colorA }} />
            <span className="tooltip-label">{labelA}</span>
            <span className="tooltip-val">{formatNumber(item[1])}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-dot" style={{ background: colorB }} />
            <span className="tooltip-label">{labelB}</span>
            <span className="tooltip-val">{formatNumber(item[2])}</span>
          </div>
        </div>
      )}
    </a>
  )
}
