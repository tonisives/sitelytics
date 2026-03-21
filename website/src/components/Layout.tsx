import type { ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"

let Nav = () => {
  let location = useLocation()

  return (
    <nav className="sticky top-0 z-50 bg-[#0a0c12]/80 backdrop-blur-md border-b border-white/5">
      <div className="max-w-[940px] mx-auto px-5 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <span className="text-lg font-semibold text-white">Sitelytics</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            to="/features"
            className={`text-sm font-medium transition-colors no-underline ${
              location.pathname === "/features" ? "text-white" : "text-[#8b90a0] hover:text-[#6c8aff]"
            }`}
          >
            Features
          </Link>
          <a
            href="https://github.com/tonisives/ti-sitelytics"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[#8b90a0] hover:text-[#6c8aff] no-underline"
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  )
}

let Footer = () => (
  <footer className="mt-36 py-10 border-t border-white/5">
    <div className="max-w-[940px] mx-auto px-5">
      <div className="flex items-center justify-center gap-3 text-sm text-[#8b90a0]">
        <a
          href="https://github.com/tonisives/ti-sitelytics"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#6c8aff]"
        >
          GitHub
        </a>
        <span className="text-[#2a2e3a]">|</span>
        <a
          href="https://twitter.com/tonisives"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-[#6c8aff]"
        >
          @tonisives
        </a>
      </div>
    </div>
  </footer>
)

export let Layout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-screen flex flex-col">
    <Nav />
    <main className="flex-1">{children}</main>
    <Footer />
  </div>
)
