import type { DailyRow } from "../types"

export let buildSparklinePath = (daily: DailyRow[], accessor: (r: DailyRow) => number): string => {
  if (daily.length === 0) return ""
  let values = daily.map(accessor)
  let max = Math.max(...values)
  if (max === 0) max = 1
  let w = 80
  let h = 24
  let step = values.length > 1 ? w / (values.length - 1) : 0

  return values
    .map((v, i) => {
      let x = i * step
      let y = h - (v / max * h)
      return i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}

export let buildSparklineFromValues = (values: number[]): string => {
  if (values.length === 0) return ""
  let max = Math.max(...values)
  if (max === 0) max = 1
  let w = 80
  let h = 24
  let step = values.length > 1 ? w / (values.length - 1) : w

  return values
    .map((v, i) => {
      let x = i * step
      let y = h - (v / max * (h - 2) + 1)
      return i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}

export let buildScaledChartPath = (yPcts: number[], totalDays: number): string => {
  if (yPcts.length === 0 || totalDays === 0) return ""
  let w = 800
  let h = 200
  let step = totalDays > 1 ? w / (totalDays - 1) : 0

  return yPcts
    .map((y, i) => {
      let x = i * step
      let yy = h - y * h
      return i === 0 ? `M${x.toFixed(1)},${yy.toFixed(1)}` : `L${x.toFixed(1)},${yy.toFixed(1)}`
    })
    .join(" ")
}
