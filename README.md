# Sitelytics

A combined Google Search Console and Google Analytics dashboard. Built with Rust (Axum) backend and React frontend.

Aggregates SEO and traffic metrics across multiple web properties into a single view - impressions, clicks, CTR, average position, and GA4 sessions.

![Dashboard view](https://cdn.tonis.dev/sitelytics/list-view.png)

![Property detail view](https://cdn.tonis.dev/sitelytics/details-impressions-and-sessions.png)

## Features

- **Multi-property overview** - see all your GSC properties at a glance with sparkline trends
- **Detailed analytics** - interactive charts with clicks, impressions, CTR, and position over time
- **GA4 integration** - sessions data from Google Analytics overlaid on GSC metrics
- **Dimension breakdown** - analyze performance by queries, pages, countries, and devices
- **Date ranges** - switch between 7, 28, and 90 day windows
- **Client-side caching** - avoids redundant API calls when navigating between views

## Tech stack

- **React 19** - frontend with SSR via Fastify
- **Recharts** - interactive data visualization
- **Axum 0.8** - Rust async HTTP backend
- **Google APIs** - Search Console v3, Analytics Admin v1beta, Analytics Data v1beta

## Setup

### Prerequisites

- Rust nightly
- Node.js 22+ and pnpm
- A Google Cloud project with OAuth 2.0 credentials and the following APIs enabled:
  - Google Search Console API
  - Google Analytics Admin API
  - Google Analytics Data API

### Google Cloud Console setup

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Go to **APIs & Services -> Library** and enable:
   - Google Search Console API
   - Google Analytics Data API
   - Google Analytics Admin API
3. Go to **APIs & Services -> Credentials** and create an OAuth 2.0 Client ID (Web application)
   - Add `http://localhost:19000/auth/callback` as an authorized redirect URI
4. Go to **Google Auth Platform -> Data Access** and add these scopes:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`
5. Go to **Google Auth Platform -> Audience** and add your Google account email as a test user

Since the app uses sensitive scopes (`analytics.readonly`) and is not verified by Google, you will see a "Google hasn't verified this app" warning when signing in. Click **"Advanced"** then **"Go to [app-name] (unsafe)"** to proceed. This is expected for development/personal use.

### Environment variables

```sh
export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
export APP_URL="http://localhost:19000"  # optional, defaults to this
```

### Run

```sh
# backend
cargo run

# frontend
cd frontend && pnpm dev
```

### Build for production

```sh
cargo build --release
cd frontend && pnpm build
```

## Deployment

A Dockerfile and Kubernetes manifests are included in `etc/deploy/`.

```sh
docker build -f etc/deploy/Dockerfile -t sitelytics .
docker run -p 19000:19000 \
  -e GOOGLE_CLIENT_ID="..." \
  -e GOOGLE_CLIENT_SECRET="..." \
  sitelytics
```

## Project structure

```
src/
  main.rs           # Axum server setup, route definitions
  api.rs            # Google API integration and data types
frontend/
  src/
    pages/          # React page components (Login, Dashboard, Detail)
    components/     # Sparkline, StatCard, DayButton
    lib/            # API client, formatting utilities
  server/           # Fastify SSR server
etc/
  deploy/           # Dockerfile, k8s manifests, skaffold config
```

## License

MIT
