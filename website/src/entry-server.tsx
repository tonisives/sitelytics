import React from "react"
import { renderToPipeableStream } from "react-dom/server"
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router-dom"
import { HelmetProvider, type HelmetServerState } from "react-helmet-async"
import { routes } from "./routes"

export type HelmetContext = { helmet: HelmetServerState }

export type RenderResult = {
  stream: ReturnType<typeof renderToPipeableStream>
  helmetContext: HelmetContext
}

let { query, dataRoutes } = createStaticHandler(routes)

let toFetchRequest = (url: string): Request => {
  let fullUrl = new URL(url, "http://localhost")
  return new Request(fullUrl.href, { method: "GET" })
}

export let render = async (url: string): Promise<RenderResult> => {
  let fetchRequest = toFetchRequest(url)
  let context = await query(fetchRequest)

  if (context instanceof Response) {
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

  return { stream, helmetContext }
}
