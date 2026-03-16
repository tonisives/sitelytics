import Fastify from "fastify"
import fastifyStatic from "@fastify/static"
import { resolve } from "node:path"
import { ssrHandler } from "./ssr-handler.js"

let isDev = process.env.NODE_ENV !== "production"
let port = Number(process.env.PORT || 19000)

let start = async () => {
  let app = Fastify({ logger: true })

  app.addHook("onSend", (_req, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff")
    reply.header("X-Frame-Options", "DENY")
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin")
    if (!isDev) {
      reply.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
    }
    done(null, payload)
  })

  if (isDev) {
    let { setupDevServer } = await import("./dev.js")
    await setupDevServer(app)
  } else {
    let clientDir = resolve(import.meta.dirname, "../../client")

    await app.register(fastifyStatic, {
      root: resolve(clientDir, "static"),
      prefix: "/static/",
      maxAge: 31536000000,
      immutable: true,
    })

    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: "/",
      decorateReply: false,
      serve: false,
    })

    let staticFiles = ["/favicon.svg", "/favicon.ico", "/robots.txt"]
    for (let file of staticFiles) {
      app.get(file, (_req, reply) => {
        return reply.sendFile(file.slice(1), clientDir)
      })
    }
  }

  app.get("/health", (_req, reply) => reply.send({ status: "ok" }))

  // Proxy API and auth to Rust backend
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
      // Forward Set-Cookie headers
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

  // SSR catch-all
  app.get("/*", ssrHandler)

  await app.listen({ port, host: "0.0.0.0" })
}

start()
