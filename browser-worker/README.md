# Sitelytics SEO browser worker

Consumes `sitelytics.seo.browser.requests` and writes to
`sitelytics.seo.browser.responses`. Both topics use one partition, with seven-day retention. Set the response topic's `max.message.bytes` to 5242880 for the maximum keyword batch. The Rust
`seo-worker` schedules jobs and consumes results. The machine endpoint verifies
that each job is active before browser navigation, so disabling a module stops
further browser work. Browser results do not use DataForSEO.

Install Node.js 22+, bmux, kubectl and `npm ci --ignore-scripts` in this directory.
Set `SITELYTICS_URL`, `SEO_BROWSER_TOKEN`, and `KAFKA_BROKERS` before `npm start`.
The token must also be present in the API's Kubernetes secret. Never commit it.

For the existing single-broker tgs cluster, `run-service.sh` starts a local
kubectl tunnels for Kafka (19094) and the Sitelytics API (19095), and directs Kafka metadata connections through its tunnel. It reads
`~/.config/sitelytics/seo-browser.env` (mode 600). Supervise the script with
launchd; install a stable copy outside temporary worktrees. `KAFKA_TUNNEL_PORT`
defaults to 19094. Set `SITELYTICS_URL=http://127.0.0.1:19095` for this launcher so machine requests do not depend on Cloudflare browser challenges. Do not use the tunnel override with a multi-broker cluster.

The worker creates its own bot session/pane per job and never uses user panes.
Google can ignore requested result depth or location hints. Encoded Google
result links are resolved before rank matching. Blocked or unrecognized pages
produce partial/unknown coverage. Manual browser intervention may be needed if
Google challenges the bot profile; the worker does not solve CAPTCHAs.

Tests: `node --test test.mjs`.
