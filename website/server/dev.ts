import type { FastifyInstance } from "fastify"
import middie from "@fastify/middie"
import { createServer as createViteServer } from "vite"
import { ssrHandler } from "./ssr-handler.js"

export let setupDevServer = async (app: FastifyInstance) => {
  let vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "custom",
  })

  ;(globalThis as any).__vite_dev_server__ = vite

  await app.register(middie)
  app.use(vite.middlewares)

  app.get("/*", ssrHandler)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let Fastify = (await import("fastify")).default
  let port = 3101

  let app = Fastify({ logger: true })
  await setupDevServer(app)

  app.get("/health", (_req, reply) => reply.send({ status: "ok" }))

  await app.listen({ port, host: "0.0.0.0" })
  console.log(`Dev server running at http://localhost:${port}`)
}
