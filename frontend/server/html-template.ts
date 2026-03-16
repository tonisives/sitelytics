import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { HelmetContext } from "../src/entry-server"

type RsbuildManifest = {
  allFiles: string[]
  entries: {
    index: {
      initial: { js: string[]; css: string[] }
      async: { js: string[] }
    }
  }
}

let manifest: RsbuildManifest | null = null

let loadManifest = (): RsbuildManifest => {
  if (manifest) return manifest
  let manifestPath = resolve(import.meta.dirname, "../../client/manifest.json")
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
  return manifest!
}

export let renderHeadHtml = (helmetContext: HelmetContext): string => {
  let m = loadManifest()
  let entry = m.entries.index

  let { helmet } = helmetContext

  let cssLinks = entry.initial.css
    .map((f) => `<link rel="stylesheet" href="${f}">`)
    .join("\n    ")

  let modulePreloads = entry.initial.js
    .slice(1)
    .map((f) => `<link rel="modulepreload" href="${f}">`)
    .join("\n    ")

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${helmet.title.toString()}
    ${helmet.meta.toString()}
    ${helmet.link.toString()}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
    ${cssLinks}
    ${modulePreloads}
  </head>
  <body>
    <div id="root">`
}

export let renderTailHtml = (): string => {
  let m = loadManifest()
  let entry = m.entries.index

  let jsScripts = entry.initial.js
    .map((f) => `<script type="module" src="${f}"></script>`)
    .join("\n    ")

  return `</div>
    ${jsScripts}
  </body>
</html>`
}
