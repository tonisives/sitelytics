import React from "react"
import ReactDOM from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { HelmetProvider } from "react-helmet-async"
import { routes } from "./routes"
import "./index.css"

let router = createBrowserRouter(routes)

let ClientApp = () => (
  <HelmetProvider>
    <RouterProvider router={router} />
  </HelmetProvider>
)

let rootEl = document.getElementById("root")!

ReactDOM.hydrateRoot(
  rootEl,
  <React.StrictMode>
    <ClientApp />
  </React.StrictMode>,
)
