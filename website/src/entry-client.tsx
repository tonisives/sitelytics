import React from "react"
import ReactDOM from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { HelmetProvider } from "react-helmet-async"
import { routes } from "./routes"
import "./index.css"

let router = createBrowserRouter(routes)

ReactDOM.hydrateRoot(
  document.getElementById("root")!,
  <React.StrictMode>
    <HelmetProvider>
      <RouterProvider router={router} />
    </HelmetProvider>
  </React.StrictMode>,
)
