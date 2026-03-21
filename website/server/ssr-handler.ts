import type { FastifyRequest, FastifyReply } from "fastify"
import { Writable } from "node:stream"
import { renderHeadHtml, renderTailHtml } from "./html-template.js"

export let ssrHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  let url = req.url

  let isDev = process.env.NODE_ENV !== "production"
  let renderFn: typeof import("../src/entry-server").render

  if (isDev) {
    let vite = (globalThis as any).__vite_dev_server__
    let mod = await vite.ssrLoadModule("/src/entry-server.tsx")
    renderFn = mod.render
  } else {
    let mod = await import("../../server/entry-server.js" as string)
    renderFn = mod.render
  }

  let { stream, helmetContext } = await renderFn(url)

  reply.raw.statusCode = 200
  reply.raw.setHeader("Content-Type", "text/html; charset=utf-8")

  let shellSent = false

  stream.pipe(
    new Writable({
      write(chunk, _encoding, callback) {
        if (!shellSent) {
          shellSent = true
          let head = isDev
            ? renderDevHeadHtml(helmetContext)
            : renderHeadHtml(helmetContext)
          reply.raw.write(head)
        }
        reply.raw.write(chunk)
        callback()
      },
      final(callback) {
        let tail = isDev
          ? renderDevTailHtml()
          : renderTailHtml()
        reply.raw.end(tail)
        callback()
      },
    }),
  )

  return reply
}

let renderDevHeadHtml = (helmetContext: any): string => {
  let { helmet } = helmetContext
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
    <script type="module" src="/@vite/client"></script>
    <script type="module">
      import RefreshRuntime from "/@react-refresh"
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body>
    <div id="root">`
}

let renderDevTailHtml = (): string => {
  return `</div>
    <script type="module" src="/src/entry-client.tsx"></script>
  </body>
</html>`
}
