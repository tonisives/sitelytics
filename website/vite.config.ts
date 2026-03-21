import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      input: "src/entry-client.tsx",
    },
  },
  server: {
    port: 3101,
  },
  ssr: {
    noExternal: command === "build"
      ? ["react-helmet-async", "react-router", "react-router-dom"]
      : [],
  },
}))
