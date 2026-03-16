export let formatNumber = (n: number): string => {
  let i = Math.floor(n)
  if (i >= 1_000_000) return `${(i / 1_000_000).toFixed(1)}M`
  if (i >= 1_000) return `${(i / 1_000).toFixed(1)}K`
  return String(i)
}

export let formatTipNumber = (n: number): string => {
  let i = Math.floor(n)
  if (i >= 1_000_000) return `${(i / 1_000_000).toFixed(1)}M`
  if (i >= 1_000) {
    let major = Math.floor(i / 1_000)
    let minor = String(i % 1_000).padStart(3, "0").replace(/0+$/, "")
    return minor ? `${major},${minor}` : `${major},000`
  }
  return String(i)
}

export let formatCtr = (n: number): string => `${(n * 100).toFixed(1)}%`

export let formatPosition = (n: number): string => n.toFixed(1)

export let formatAxisNumber = (n: number): string => {
  let i = Math.floor(n)
  if (i >= 1_000_000) return `${Math.round(i / 1_000_000)}M`
  if (i >= 1_000) return `${Math.round(i / 1_000)}K`
  return String(i)
}

export let cleanUrl = (url: string): string =>
  url
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
