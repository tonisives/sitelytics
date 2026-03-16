import { type RouteObject, Outlet } from "react-router-dom"
import { Login } from "./pages/Login"
import { Dashboard } from "./pages/Dashboard"
import { Detail } from "./pages/Detail"

let RootLayout = () => <Outlet />

export let routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/login", element: <Login /> },
      { path: "/property/:site", element: <Detail /> },
    ],
  },
]
