import { build } from "esbuild"
import { rmSync, mkdirSync } from "node:fs"

rmSync("dist/fastify", { recursive: true, force: true })
mkdirSync("dist/fastify/server", { recursive: true })

await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  outfile: "dist/fastify/server/index.js",
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "external",
  external: ["../../server/index.js"],
  banner: {
    js: [
      `import { fileURLToPath as __fileURLToPath } from "url";`,
      `import { dirname as __dirname_fn } from "path";`,
      `const __filename = __fileURLToPath(import.meta.url);`,
      `const __dirname = __dirname_fn(__filename);`,
    ].join("\n"),
  },
  define: {
    "import.meta.dirname": "__dirname",
  },
})

console.log("Server build complete")
