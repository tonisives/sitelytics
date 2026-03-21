import Fastify from "fastify"
import fastifyStatic from "@fastify/static"
import { resolve } from "node:path"
import { ssrHandler } from "./ssr-handler.js"

let isDev = process.env.NODE_ENV !== "production"
let port = Number(process.env.PORT || 3000)

let start = async () => {
  let app = Fastify({ logger: true })

  if (isDev) {
    let { setupDevServer } = await import("./dev.js")
    await setupDevServer(app)
  } else {
    let clientDir = resolve(import.meta.dirname, "../../client")

    await app.register(fastifyStatic, {
      root: resolve(clientDir, "assets"),
      prefix: "/assets/",
      maxAge: 31536000000,
      immutable: true,
    })

    await app.register(fastifyStatic, {
      root: resolve(clientDir, "images"),
      prefix: "/images/",
      decorateReply: false,
    })

    let rootStatic = resolve(clientDir)
    let staticFiles = ["/robots.txt"]
    for (let file of staticFiles) {
      app.get(file, (_req, reply) => {
        return reply.sendFile(file.slice(1), rootStatic)
      })
    }
  }

  app.get("/health", (_req, reply) => reply.send({ status: "ok" }))

  app.get("/*", ssrHandler)

  await app.listen({ port, host: "0.0.0.0" })
}

start()
