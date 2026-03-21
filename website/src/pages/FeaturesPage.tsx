import { Layout } from "../components/Layout"
import { SEOHead } from "../components/SEOHead"
import { cdn } from "../cdn"

export let FeaturesPage = () => (
  <Layout>
    <SEOHead
      title="Features - Sitelytics"
      description="Sitelytics features: multi-property dashboard, GA4 integration, interactive charts, dimension breakdowns, date ranges, and client-side caching."
      canonicalUrl="/features"
    />

    <section className="mt-16">
      <div className="max-w-[740px] mx-auto px-5">
        <h1 className="text-3xl sm:text-[40px] font-semibold text-white mb-4">Features</h1>
        <p className="text-[#8b90a0] text-base leading-[28px] mb-12">
          Sitelytics aggregates Google Search Console and Google Analytics 4 data into a single dashboard.
          Monitor all your web properties without switching between Google tools.
        </p>
      </div>
    </section>

    {/* Multi-property dashboard */}
    <section className="mt-8">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="bg-[#1a1d27] rounded-xl border border-[#2a2e3a] p-8 sm:p-12">
          <h2 className="text-xl font-semibold text-white mb-3">Multi-property dashboard</h2>
          <p className="text-[#8b90a0] mb-8 max-w-[600px]">
            See aggregate impressions, clicks, CTR, average position, and GA4 sessions across all properties.
            Each property row includes sparkline trends for clicks and impressions so you can spot changes at a glance.
          </p>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <img
              src={`${cdn}/list-view.png`}
              alt="Dashboard with all properties and sparkline trends"
              className="w-full"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>

    {/* Detail view */}
    <section className="mt-12">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="bg-[#1a1d27] rounded-xl border border-[#2a2e3a] p-8 sm:p-12">
          <h2 className="text-xl font-semibold text-white mb-3">Interactive charts</h2>
          <p className="text-[#8b90a0] mb-8 max-w-[600px]">
            Drill into any property for daily performance charts. Toggle between clicks, impressions, CTR, and position.
            GA4 metrics overlay on a secondary axis - sessions, pageviews, engaged sessions, bounce rate, and average duration.
          </p>
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <img
              src={`${cdn}/details-impressions-and-sessions.png`}
              alt="Property detail with interactive charts"
              className="w-full"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>

    {/* Other features */}
    <section className="mt-12">
      <div className="max-w-[940px] mx-auto px-5">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Dimension breakdown</h3>
            <p className="text-sm text-[#8b90a0] font-light leading-relaxed">
              Analyze performance by search queries, landing pages, countries, and device types.
              See clicks, impressions, CTR, and average position for each dimension row.
            </p>
          </div>
          <div className="bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Date ranges</h3>
            <p className="text-sm text-[#8b90a0] font-light leading-relaxed">
              Switch between 7, 28, and 90 day windows. Both the dashboard totals and
              detail charts update to reflect the selected range.
            </p>
          </div>
          <div className="bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">GA4 sessions</h3>
            <p className="text-sm text-[#8b90a0] font-light leading-relaxed">
              Sessions from Google Analytics 4 are fetched alongside GSC data. Dashboard shows total
              sessions per property; detail view shows daily session trends on charts.
            </p>
          </div>
          <div className="bg-[#1a1d27] border border-[#2a2e3a] rounded-xl p-6">
            <h3 className="font-semibold text-white mb-2">Client-side caching</h3>
            <p className="text-sm text-[#8b90a0] font-light leading-relaxed">
              API responses are cached in-memory. Navigate between the dashboard and property
              details without redundant API calls to Google.
            </p>
          </div>
        </div>
      </div>
    </section>

    {/* Tech stack */}
    <section className="mt-24">
      <div className="max-w-[940px] mx-auto px-5">
        <h2 className="text-xl font-semibold text-white mb-6">Tech stack</h2>
        <div className="overflow-hidden rounded-xl border border-[#2a2e3a]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1a1d27]">
                <th className="text-left px-6 py-3 text-[#8b90a0] font-medium text-xs uppercase tracking-wider">Component</th>
                <th className="text-left px-6 py-3 text-[#8b90a0] font-medium text-xs uppercase tracking-wider">Technology</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Backend", "Rust, Axum 0.8, Tokio async runtime"],
                ["Frontend", "React 19, TypeScript, Recharts"],
                ["Rendering", "Server-side rendering with Fastify + client hydration"],
                ["Auth", "Google OAuth 2.0 with cookie-based sessions"],
                ["APIs", "Google Search Console v3, GA Admin v1beta, GA Data v1beta"],
                ["Styling", "Dark theme CSS with custom properties"],
              ].map(([component, tech]) => (
                <tr key={component} className="border-t border-[#2a2e3a]">
                  <td className="px-6 py-3 text-white font-mono font-medium">{component}</td>
                  <td className="px-6 py-3 text-[#8b90a0]">{tech}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </Layout>
)
