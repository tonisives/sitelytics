import { useState, useCallback, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { LineChart, Line, Tooltip, ResponsiveContainer, YAxis } from "recharts"
import { formatNumber } from "../lib/format"

let PortalTooltip = ({ active, payload, coordinate, containerRef, color, dataLabel }: any) => {
  if (!active || !payload?.length || !containerRef?.current) return null
  let rect = containerRef.current.getBoundingClientRect()
  let x = rect.left + (coordinate?.x ?? 0)
  let y = rect.top + (coordinate?.y ?? 0)
  let date = payload[0]?.payload?.date ?? ""

  return createPortal(
    <div
      className="sparkline-tip"
      style={{
        position: "fixed",
        left: x,
        top: y - 8,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <div className="tooltip-date">{date}</div>
      <div className="tooltip-row">
        <span className="tooltip-dot" style={{ background: color }} />
        <span className="tooltip-label">{dataLabel}</span>
        <span className="tooltip-val">{formatNumber(payload[0].value)}</span>
      </div>
    </div>,
    document.body,
  )
}

let PortalOverlayTooltip = ({ active, payload, coordinate, containerRef, colorA, colorB, labelA, labelB }: any) => {
  if (!active || !payload?.length || !containerRef?.current) return null
  let rect = containerRef.current.getBoundingClientRect()
  let x = rect.left + (coordinate?.x ?? 0)
  let y = rect.top + (coordinate?.y ?? 0)
  let date = payload[0]?.payload?.date ?? ""

  return createPortal(
    <div
      className="sparkline-tip"
      style={{
        position: "fixed",
        left: x,
        top: y - 8,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <div className="tooltip-date">{date}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="tooltip-row">
          <span className="tooltip-dot" style={{ background: i === 0 ? colorB : colorA }} />
          <span className="tooltip-label">{i === 0 ? labelB : labelA}</span>
          <span className="tooltip-val">{formatNumber(p.value)}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export let SparklineTooltip = ({
  href, color, data, label,
}: {
  href: string
  path?: string
  color: string
  data: [string, number][]
  label: string
}) => {
  let chartData = useMemo(() => data.map(([date, value]) => ({ date, value })), [data])
  let containerRef = useRef<HTMLAnchorElement>(null)

  return (
    <a href={href} className="row-link sparkline-tooltip-wrap" ref={containerRef}>
      <ResponsiveContainer width={80} height={24}>
        <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide domain={[0, (max: number) => max || 1]} />
          <Line
            type="linear"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            content={<PortalTooltip containerRef={containerRef} color={color} dataLabel={label} />}
            cursor={{ stroke: "var(--text-muted)", strokeWidth: 1, opacity: 0.5 }}
            wrapperStyle={{ visibility: "hidden" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </a>
  )
}

export let OverlaySparklineTooltip = ({
  href, colorA, colorB, data, labelA, labelB,
}: {
  href: string
  pathA?: string
  pathB?: string
  colorA: string
  colorB: string
  data: [string, number, number][]
  labelA: string
  labelB: string
}) => {
  let chartData = useMemo(
    () => data.map(([date, a, b]) => ({ date, a, b })),
    [data],
  )
  let containerRef = useRef<HTMLAnchorElement>(null)

  return (
    <a href={href} className="row-link sparkline-tooltip-wrap" ref={containerRef}>
      <ResponsiveContainer width={80} height={24}>
        <LineChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide yAxisId="a" domain={[0, (max: number) => max || 1]} />
          <YAxis hide yAxisId="b" domain={[0, (max: number) => max || 1]} />
          <Line yAxisId="b" type="linear" dataKey="b" stroke={colorB} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="a" type="linear" dataKey="a" stroke={colorA} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Tooltip
            content={<PortalOverlayTooltip containerRef={containerRef} colorA={colorA} colorB={colorB} labelA={labelA} labelB={labelB} />}
            cursor={{ stroke: "var(--text-muted)", strokeWidth: 1, opacity: 0.5 }}
            wrapperStyle={{ visibility: "hidden" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </a>
  )
}
