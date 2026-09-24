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
