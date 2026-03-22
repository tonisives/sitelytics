import { useState, useCallback, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import { LineChart, Line, Tooltip, ResponsiveContainer, YAxis, CartesianGrid } from "recharts"
import { formatNumber, formatAxisNumber } from "../lib/format"

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
  href, color, data, label, globalMax,
}: {
  href: string
  path?: string
  color: string
  data: [string, number][]
  label: string
  globalMax?: number
}) => {
  let chartData = useMemo(() => data.map(([date, value]) => ({ date, value })), [data])
  let maxVal = globalMax ?? Math.max(0, ...data.map(([, v]) => v))
  let containerRef = useRef<HTMLAnchorElement>(null)

  return (
    <a href={href} className="row-link sparkline-tooltip-wrap" ref={containerRef}>
      <ResponsiveContainer width={140} height={32}>
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <CartesianGrid horizontal vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
          <YAxis
            domain={[0, maxVal || 1]}
            orientation="right"
            tick={{ fill: color, fontSize: 8, fontFamily: "var(--mono)" }}
            tickFormatter={formatAxisNumber}
            width={28}
            ticks={maxVal === 0 ? [0] : undefined}
            tickCount={maxVal === 0 ? undefined : 3}
            axisLine={false}
            tickLine={false}
          />
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
  href, colorA, colorB, data, labelA, labelB, globalMaxA, globalMaxB,
}: {
  href: string
  pathA?: string
  pathB?: string
  colorA: string
  colorB: string
  data: [string, number, number][]
  labelA: string
  labelB: string
  globalMaxA?: number
  globalMaxB?: number
}) => {
  let chartData = useMemo(
    () => data.map(([date, a, b]) => ({ date, a, b })),
    [data],
  )
  let maxA = globalMaxA ?? Math.max(0, ...data.map(([, a]) => a))
  let maxB = globalMaxB ?? Math.max(0, ...data.map(([,, b]) => b))
  let containerRef = useRef<HTMLAnchorElement>(null)

  return (
    <a href={href} className="row-link sparkline-tooltip-wrap" ref={containerRef}>
      <ResponsiveContainer width={140} height={32}>
        <LineChart data={chartData} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <CartesianGrid horizontal vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
          <YAxis
            yAxisId="a"
            domain={[0, maxA || 1]}
            orientation="left"
            tick={{ fill: colorA, fontSize: 8, fontFamily: "var(--mono)" }}
            tickFormatter={formatAxisNumber}
            width={28}
            ticks={maxA === 0 ? [0] : undefined}
            tickCount={maxA === 0 ? undefined : 3}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="b"
            domain={[0, maxB || 1]}
            orientation="right"
            tick={{ fill: colorB, fontSize: 8, fontFamily: "var(--mono)" }}
            tickFormatter={formatAxisNumber}
            width={28}
            ticks={maxB === 0 ? [0] : undefined}
            tickCount={maxB === 0 ? undefined : 3}
            axisLine={false}
            tickLine={false}
          />
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
