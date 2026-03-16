import type { FastifyInstance } from "fastify"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createRsbuild, loadConfig } from "@rsbuild/core"
import middie from "@fastify/middie"
import { ssrHandler } from "./ssr-handler.js"

let isNavigationRequest = (req: IncomingMessage): boolean => {
  if (req.method !== "GET") return false
  let url = req.url || ""
  if (
    url.startsWith("/static/") ||
    url.startsWith("/__rsbuild") ||
    url.includes(".hot-update.") ||
    /\.\w{1,6}$/.test(url.split("?")[0])
  ) {
    return false
  }
  let accept = req.headers.accept || ""
  return accept.includes("text/html")
}

export let setupDevServer = async (app: FastifyInstance) => {
  let { content } = await loadConfig({ cwd: process.cwd() })
  content.server = { ...content.server, middlewareMode: true, htmlFallback: false }
  let rsbuild = await createRsbuild({ rsbuildConfig: content })

  let rsbuildServer = await rsbuild.createDevServer()

  ;(globalThis as any).__rsbuild_dev_server__ = rsbuildServer

  await app.register(middie)

  let rsbuildMiddleware = rsbuildServer.middlewares
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (isNavigationRequest(req)) {
      next()
      return
    }
    rsbuildMiddleware(req, res, next)
  })

  // Proxy API and auth to Rust backend in dev
  let apiBaseUrl = process.env.API_BASE_URL || "http://localhost:19100"

  app.all("/api/*", async (req, reply) => {
    let url = `${apiBaseUrl}${req.url}`
    let headers: Record<string, string> = {}
    for (let [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value
    }
    delete headers.host

    try {
      let res = await fetch(url, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
      })
      reply.status(res.status)
      for (let [key, value] of res.headers) {
        if (key.toLowerCase() !== "transfer-encoding") reply.header(key, value)
      }
      reply.send(await res.text())
    } catch {
      reply.status(502).send("Backend unavailable")
    }
  })

  app.get("/auth/*", async (req, reply) => {
    let url = `${apiBaseUrl}${req.url}`
    try {
      let res = await fetch(url, {
        method: "GET",
        headers: { cookie: req.headers.cookie || "" },
        redirect: "manual",
      })
      let setCookies = res.headers.getSetCookie()
      for (let c of setCookies) {
        reply.header("set-cookie", c)
      }
      if (res.status >= 300 && res.status < 400) {
        let location = res.headers.get("location") || "/"
        return reply.redirect(location)
      }
      reply.status(res.status)
      reply.send(await res.text())
    } catch {
      reply.status(502).send("Backend unavailable")
    }
  })

  app.get("/*", ssrHandler)

  app.addHook("onReady", async () => {
    rsbuildServer.connectWebSocket({ server: app.server })
  })
}

let main = async () => {
  let Fastify = (await import("fastify")).default
  let port = 19000

  let app = Fastify({ logger: true })
  await setupDevServer(app)

  app.get("/health", (_req, reply) => reply.send({ status: "ok" }))

  await app.listen({ port, host: "0.0.0.0" })
  console.log(`Dev server running at http://localhost:${port}`)
}

main()
