# Sitelytics SEO browser worker

The worker consumes `sitelytics.seo.browser.requests`, sends each page to the
shared k3s Chromium queue at `tskr.scrape.headless.requests`, and reads rendered
HTML from `tskr.scrape.responses`. It publishes completed SEO jobs to
`sitelytics.seo.browser.responses`. The Rust `seo-worker` schedules jobs and
stores results. All four topics must exist. Keep the SEO response topic's
`max.message.bytes` at 5242880 for large keyword batches.

Run one replica using `etc/deploy/seo-browser-worker.yaml`. Build
`browser-worker/Dockerfile` and set its image in the deployment. Set
`KAFKA_BROKERS`, `SITELYTICS_URL`, and `SEO_BROWSER_TOKEN`; the token must also
be in the Sitelytics API secret. The worker checks that each SEO job remains
active before every page request. It uses the shared scraper's browser pool,
domain concurrency and pacing. Google may block automated requests, which
produces partial coverage. The requested country and language are search hints.

Run `npm ci --ignore-scripts && npm test` in this directory.

## Portable bmux pilot

The production backend remains the shared Playwright queue. Set
`SEO_BROWSER_BACKEND=bmux` only in a separate pilot deployment with bmux available
in PATH. The pilot uses fixed isolated topics:
`sitelytics.seo.browser.pilot.requests` and
`sitelytics.seo.browser.pilot.responses`, with consumer group
`sitelytics-seo-bmux-pilot-v1`. Production requests and responses are never consumed
or written in this mode. Feed explicitly selected authorized jobs into the pilot
request topic and inspect its responses separately.

Run the worker alongside `bmux host`, sharing its data directory and control
socket with the same Unix UID. Set `BMUX_REQUIRED_PROXY` on the host to the private
HomeProxy endpoint. Configure observation using `BMUX_REMOTE_CONFIG` on the host.
The worker reports job attempts through the local CLI; unavailable observation
does not stop scraping. Browser sessions are isolated per job, with a dedicated
persistent pilot profile. Human takeover causes bounded retries for up to five
minutes while Kafka heartbeats and cancellation checks continue. A session still
held by a human at cleanup is retained for inspection.

Tests: `node --test test.mjs bmux.test.mjs`.

Build the optional all-in-one pilot image from this directory:

```sh
docker build -f Dockerfile.bmux --build-arg BMUX_IMAGE=bmux-host:local -t sitelytics-bmux-pilot .
```

The supervisor waits for the local browser socket before starting the worker and
terminates both if either exits. Run as UID 1000 with the bmux Chromium seccomp
profile, a 256 MiB shared-memory mount, and persistent `/data`. Mount the optional
remote identity/configuration at private paths and set `BMUX_REMOTE_CONFIG`.
`BMUX_REQUIRED_PROXY` applies to browser navigation, including pilot research.
The image's readiness probe checks the existing socket without starting a host.
Pilot requests must be explicitly published to the pilot topic; the production
API and production worker keep their existing queue routing.
