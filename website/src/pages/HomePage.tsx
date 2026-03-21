import { Link } from "react-router-dom"
import { Layout } from "../components/Layout"
import { SEOHead } from "../components/SEOHead"
import { cdn } from "../cdn"

let features = [
  {
    title: "Multi-property overview",
    description: "All your Google Search Console properties at a glance with sparkline trends for clicks and impressions.",
  },
  {
    title: "GA4 integration",
    description: "Sessions, pageviews, engaged sessions, bounce rate, and average duration from Google Analytics overlaid on GSC metrics.",
  },
  {
    title: "Interactive charts",
    description: "Daily performance charts with toggleable metrics. Click through impressions, clicks, CTR, and position over time.",
  },
  {
    title: "Dimension breakdown",
    description: "Analyze performance by queries, pages, countries, and devices to find what drives your traffic.",
  },
  {
    title: "Date ranges",
    description: "Switch between 7, 28, and 90 day windows to spot trends at different time scales.",
  },
  {
    title: "Client-side caching",
    description: "Smart caching avoids redundant API calls when navigating between views.",
  },
]

let techStack = [
  { name: "Rust + Axum", description: "Backend API server with OAuth2 session management" },
  { name: "React 19 + SSR", description: "Server-rendered frontend with client hydration" },
  { name: "Recharts", description: "Interactive data visualization for daily trends" },
  { name: "Google APIs", description: "Search Console v3, Analytics Admin, Analytics Data" },
]

let Button3D = ({ href, children, variant = "dark" }: { href: string; children: string; variant?: "dark" | "blue" }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-block no-underline"
  >
    <div className="relative">
      <div
        className={`relative z-10 px-9 py-3 border border-white/10 rounded-[10px] text-center font-medium ${
          variant === "blue"
            ? "bg-[#3d5afe] text-white"
            : "bg-[#1a1d27] text-[#6c8aff]"
        }`}
      >
        {children}
      </div>
      <div className="absolute inset-0 bg-[#6c8aff]/20 rounded-[10px] translate-x-[4px] translate-y-[4px] -z-10" />
    </div>
  </a>
)

export let HomePage = () => (
  <Layout>
    <SEOHead
      title="Sitelytics - Google Search Console & Analytics Dashboard"
      description="A unified dashboard for Google Search Console and Google Analytics. View impressions, clicks, CTR, position, and GA4 sessions across all your web properties."
      canonicalUrl="/"
    />

    {/* Hero */}
    <section className="min-h-[80vh] flex items-center justify-center relative">
      <div className="max-w-[800px] mx-auto px-5 text-center">
        <div className="mb-8">
          <div className="inline-block px-4 py-1.5 rounded-full border border-[#6c8aff]/30 text-[#6c8aff] text-xs font-medium mb-6 tracking-wide">
            OPEN SOURCE SEO DASHBOARD
          </div>
          <h1 className="text-3xl sm:text-[48px] font-semibold text-white leading-tight mb-6">
            All your search metrics.<br />One dashboard.
          </h1>
          <p className="text-base text-[#8b90a0] font-light leading-[28px] max-w-[560px] mx-auto mb-10">
            Aggregate Google Search Console and Google Analytics data across multiple web properties.
            Impressions, clicks, CTR, position, and sessions in a single view.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Button3D href="https://github.com/tonisives/ti-sitelytics" variant="blue">View on GitHub</Button3D>
            <Link to="/features" className="no-underline">
              <div className="relative">
                <div className="relative z-10 px-9 py-3 border border-white/10 rounded-[10px] text-center font-medium bg-[#1a1d27] text-[#e1e4eb]">
                  Features
                </div>
                <div className="absolute inset-0 bg-white/5 rounded-[10px] translate-x-[4px] translate-y-[4px] -z-10" />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </section>

    {/* Dashboard screenshot */}
    <section className="-mt-12">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="rounded-xl border border-white/10 overflow-hidden shadow-2xl shadow-black/50">
          <img
            src={`${cdn}/list-view.png`}
            alt="Sitelytics dashboard showing multi-property overview with sparkline trends"
            className="w-full"
            loading="lazy"
          />
        </div>
      </div>
    </section>

    {/* Features */}
    <section className="mt-36">
      <div className="max-w-[940px] mx-auto px-5">
        <h2 className="text-[28px] font-semibold text-white mb-2">Features</h2>
        <p className="text-[#8b90a0] mb-10">Everything you need to monitor your web properties.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6 hover:border-[#6c8aff]/30 transition-colors"
            >
              <h3 className="font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-[#8b90a0] font-light leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Detail screenshot */}
    <section className="mt-36">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="bg-[#1a1d27] rounded-xl border border-[#2a2e3a] p-8 sm:p-12">
          <h2 className="text-[28px] font-semibold text-white mb-4">Detailed property analytics</h2>
          <p className="text-[#8b90a0] mb-8 max-w-[600px]">
            Drill into any property for interactive charts with daily trends, GA4 session overlay,
            and dimension breakdowns by queries, pages, countries, and devices.
          </p>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <img
              src={`${cdn}/details-impressions-and-sessions.png`}
              alt="Property detail view showing interactive charts with impressions and sessions"
              className="w-full"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>

    {/* Tech stack */}
    <section className="mt-36">
      <div className="max-w-[940px] mx-auto px-5">
        <h2 className="text-[28px] font-semibold text-white mb-2">Tech stack</h2>
        <p className="text-[#8b90a0] mb-10">Built for performance and reliability.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {techStack.map((t) => (
            <div
              key={t.name}
              className="flex items-start gap-4 bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6"
            >
              <div>
                <h3 className="font-semibold text-white mb-1 font-mono text-sm">{t.name}</h3>
                <p className="text-sm text-[#8b90a0] font-light">{t.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Setup CTA */}
    <section className="mt-36">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="flex flex-col items-center">
          <div className="bg-[#1a1d27] rounded-xl border border-[#2a2e3a] p-8 sm:p-12 max-w-[600px] w-full text-center">
            <h2 className="text-[28px] font-semibold text-white mb-4">Get started</h2>
            <div className="h-px bg-white/5 my-6" />
            <div className="bg-[#0f1117] rounded-lg py-4 px-5 text-sm text-left mb-4 font-mono text-[#e1e4eb]">
              git clone https://github.com/tonisives/ti-sitelytics
            </div>
            <p className="text-sm text-[#8b90a0] mb-2">
              Requires a Google Cloud project with OAuth 2.0 credentials.
            </p>
            <p className="text-sm text-[#8b90a0] mb-6">
              See the{" "}
              <a
                href="https://github.com/tonisives/ti-sitelytics#setup"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6c8aff] hover:text-[#8b90a0]"
              >
                setup guide
              </a>
              {" "}for details.
            </p>
            <div className="h-px bg-white/5 my-6" />
            <div className="space-y-3 text-left">
              {["Open source (MIT License)", "Self-hosted - your data stays with you", "Rust backend for fast API responses", "SSR frontend for quick page loads"].map((f) => (
                <div key={f} className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4caf7a] shrink-0" />
                  <span className="text-sm text-[#e1e4eb]">{f}</span>
                </div>
              ))}
            </div>
            <div className="mt-8">
              <Button3D href="https://github.com/tonisives/ti-sitelytics" variant="blue">View on GitHub</Button3D>
            </div>
          </div>
        </div>
      </div>
    </section>
  </Layout>
)
