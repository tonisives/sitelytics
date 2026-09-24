CREATE TABLE seo_sites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 site_url text NOT NULL,
 config jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,site_url)
);
CREATE TABLE seo_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 site_id uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
 module text NOT NULL CHECK(module IN ('keywords','rankings','research','audit')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_browser','succeeded','partial','failed','cancelled')),
 config jsonb NOT NULL,
 result jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 completed_at timestamptz,
 dispatched_at timestamptz
);
CREATE UNIQUE INDEX seo_jobs_active ON seo_jobs(site_id,module) WHERE status IN ('queued','running','waiting_browser');
CREATE INDEX seo_jobs_history ON seo_jobs(site_id,created_at DESC);
CREATE TABLE seo_schedules (
 site_id uuid NOT NULL REFERENCES seo_sites(id) ON DELETE CASCADE,
 module text NOT NULL,
 next_run_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 PRIMARY KEY(site_id,module)
);
CREATE TABLE seo_worker_health (
 worker text PRIMARY KEY,
 heartbeat_at timestamptz NOT NULL DEFAULT now(),
 detail jsonb NOT NULL DEFAULT '{}'
);
