import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { HelmetContext } from "../src/entry-server"

type Manifest = Record<string, { file: string; css?: string[]; imports?: string[] }>

let manifest: Manifest | null = null

let loadManifest = (): Manifest => {
  if (manifest) return manifest
  let manifestPath = resolve(import.meta.dirname, "../../client/.vite/manifest.json")
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
  return manifest!
}

let collectCss = (m: Manifest, entry: string, seen = new Set<string>()): string[] => {
  let css: string[] = []
  let info = m[entry]
  if (!info || seen.has(entry)) return css
  seen.add(entry)
  if (info.css) css.push(...info.css)
  if (info.imports) {
    for (let imp of info.imports) {
      css.push(...collectCss(m, imp, seen))
    }
  }
  return css
}

export let renderHeadHtml = (helmetContext: HelmetContext): string => {
  let m = loadManifest()
  let entry = m["src/entry-client.tsx"]
  let cssFiles = collectCss(m, "src/entry-client.tsx")

  let { helmet } = helmetContext

  let cssLinks = cssFiles
    .map((f) => `<link rel="stylesheet" href="/${f}">`)
    .join("\n    ")

  let modulePreload = entry.imports
    ? entry.imports.map((imp) => {
        let f = m[imp]?.file
        return f ? `<link rel="modulepreload" href="/${f}">` : ""
      }).filter(Boolean).join("\n    ")
    : ""

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${helmet.title.toString()}
    ${helmet.meta.toString()}
    ${helmet.link.toString()}
    <meta name="theme-color" content="#0a0c12" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    ${cssLinks}
    ${modulePreload}
  </head>
  <body>
    <div id="root">`
}

export let renderTailHtml = (): string => {
  let m = loadManifest()
  let entry = m["src/entry-client.tsx"]

  return `</div>
    <script type="module" src="/${entry.file}"></script>
  </body>
</html>`
}
