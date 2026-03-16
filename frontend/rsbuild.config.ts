import { defineConfig } from "@rsbuild/core"
import { pluginReact } from "@rsbuild/plugin-react"

let isProd = process.env.NODE_ENV === "production"

export default defineConfig({
  plugins: [pluginReact()],
  server: {
    port: 19001,
  },
  environments: {
    web: {
      source: {
        entry: { index: "./src/entry-client.tsx" },
      },
      output: {
        target: "web",
        manifest: isProd,
        distPath: { root: "dist/client" },
        filename: {
          js: "[name].[contenthash:8].js",
          css: "[name].[contenthash:8].css",
        },
      },
      html: {
        template: "./index.html",
      },
    },
    node: {
      source: {
        entry: { index: "./src/entry-server.tsx" },
      },
      output: {
        target: "node",
        module: true,
        distPath: { root: "dist/server" },
        filename: {
          js: "[name].js",
        },
      },
    },
  },
  output: {
    cleanDistPath: true,
  },
})
