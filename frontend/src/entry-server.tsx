import React from "react"
import { renderToPipeableStream } from "react-dom/server"
import { Writable } from "node:stream"
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router-dom"
import { HelmetProvider, type HelmetServerState } from "react-helmet-async"
import { routes } from "./routes"

export type HelmetContext = { helmet: HelmetServerState }

export type RenderResult = {
  html: string
  helmetContext: HelmetContext
  redirect?: string
}

let { query, dataRoutes } = createStaticHandler(routes)

let toFetchRequest = (url: string): Request => {
  let fullUrl = new URL(url, "http://localhost")
  return new Request(fullUrl.href, { method: "GET" })
}

let collectStream = (stream: ReturnType<typeof renderToPipeableStream>): Promise<string> =>
  new Promise((resolve, reject) => {
    let chunks: Buffer[] = []
    stream.pipe(
      new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          callback()
        },
        final(callback) {
          resolve(Buffer.concat(chunks).toString("utf-8"))
          callback()
        },
      }),
    )
    setTimeout(() => reject(new Error("SSR render timeout")), 10_000)
  })

export let render = async (url: string): Promise<RenderResult> => {
  let fetchRequest = toFetchRequest(url)
  let context = await query(fetchRequest)

  if (context instanceof Response) {
    let location = context.headers.get("Location")
    if (location) {
      return { html: "", helmetContext: {} as HelmetContext, redirect: location }
    }
    throw context
  }

  let router = createStaticRouter(dataRoutes, context)
  let helmetContext = {} as HelmetContext

  let stream = renderToPipeableStream(
    <React.StrictMode>
      <HelmetProvider context={helmetContext}>
        <StaticRouterProvider router={router} context={context} />
      </HelmetProvider>
    </React.StrictMode>,
  )

  let html = await collectStream(stream)
  return { html, helmetContext }
}
