import type { RouteObject } from "react-router-dom"
import { useEffect } from "react"
import { Outlet, useLocation } from "react-router-dom"
import { HomePage } from "./pages/HomePage"
import { FeaturesPage } from "./pages/FeaturesPage"

let ScrollToTop = () => {
  let { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

let RootLayout = () => (
  <>
    <ScrollToTop />
    <Outlet />
  </>
)

export let routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/features", element: <FeaturesPage /> },
    ],
  },
]
