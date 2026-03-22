import type { FastifyRequest, FastifyReply } from "fastify"
import { renderHeadHtml, renderTailHtml } from "./html-template.js"

export let ssrHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  let url = req.url

  let [path] = url.split("?")
  if (path.startsWith("/.well-known/") || path.startsWith("/favicon") || path.startsWith("/src/")) {
    return reply.code(404).send("")
  }

  let isDev = process.env.NODE_ENV !== "production"
  let renderFn: typeof import("../src/entry-server").render

  if (isDev) {
    let rsbuild = (globalThis as any).__rsbuild_dev_server__
    let mod: typeof import("../src/entry-server") = await rsbuild.environments.node.loadBundle("index")
    renderFn = mod.render
  } else {
    let mod = await import("../../server/index.js" as string)
    renderFn = mod.render
  }

  let result = await renderFn(url)

  if (result.redirect) {
    return reply.redirect(result.redirect)
  }

  let { html: body, helmetContext } = result

  let html: string

  if (isDev) {
    let rsbuild = (globalThis as any).__rsbuild_dev_server__
    let template = await rsbuild.environments.web.getTransformedHtml("index")

    let { helmet } = helmetContext
    let helmetTags = [
      helmet.title.toString(),
      helmet.meta.toString(),
      helmet.link.toString(),
    ].filter(Boolean).join("\n    ")

    html = template
      .replace("<!--app-content-->", body)
      .replace("</head>", `    ${helmetTags}\n  </head>`)
  } else {
    let head = renderHeadHtml(helmetContext)
    let tail = renderTailHtml()
    html = head + body + tail
  }

  return reply
    .type("text/html; charset=utf-8")
    .send(html)
}
