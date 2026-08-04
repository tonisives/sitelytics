CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub text NOT NULL UNIQUE,
    email text NOT NULL UNIQUE,
    display_name text,
    avatar_url text,
    is_admin boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_valid_idx ON user_sessions(token_hash, expires_at);

CREATE TABLE oauth_credentials (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_refresh_token bytea NOT NULL,
    nonce bytea NOT NULL,
    access_token text NOT NULL,
    access_token_expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE aeo_cadence AS ENUM ('weekly', 'monthly');
CREATE TYPE aeo_query_kind AS ENUM ('discovery', 'branded');
CREATE TYPE aeo_provider AS ENUM ('chatgpt', 'perplexity', 'claude');
CREATE TYPE aeo_visibility_level AS ENUM ('absent', 'cited', 'mentioned', 'recommended', 'top_pick');
CREATE TYPE aeo_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'blocked', 'unknown');

CREATE TABLE aeo_properties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    site_url text NOT NULL,
    brand_name text NOT NULL,
    owned_domain text NOT NULL,
    aliases text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, site_url)
);

CREATE TABLE aeo_queries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES aeo_properties(id) ON DELETE CASCADE,
    prompt text NOT NULL,
    kind aeo_query_kind NOT NULL,
    cadence aeo_cadence NOT NULL,
    active boolean NOT NULL DEFAULT true,
    next_run_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aeo_queries_due_idx ON aeo_queries(next_run_at) WHERE active;

CREATE TABLE aeo_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    query_id uuid NOT NULL REFERENCES aeo_queries(id) ON DELETE CASCADE,
    scheduled_for timestamptz NOT NULL,
    status aeo_job_status NOT NULL DEFAULT 'queued',
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(query_id, scheduled_for)
);

CREATE TABLE aeo_samples (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES aeo_runs(id) ON DELETE CASCADE,
    provider aeo_provider NOT NULL,
    sample_number smallint NOT NULL CHECK (sample_number BETWEEN 1 AND 3),
    status aeo_job_status NOT NULL DEFAULT 'queued',
    level aeo_visibility_level,
    rank integer,
    owned_domain_cited boolean,
    evidence text,
    citations jsonb NOT NULL DEFAULT '[]',
    competitors jsonb NOT NULL DEFAULT '[]',
    raw_answer text,
    error_code text,
    latency_ms integer,
    transport_key text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    raw_expires_at timestamptz,
    UNIQUE(run_id, provider, sample_number)
);
CREATE INDEX aeo_samples_transport_idx ON aeo_samples(transport_key) WHERE transport_key IS NOT NULL;

CREATE TABLE aeo_provider_health (
    provider aeo_provider PRIMARY KEY,
    circuit_open_until timestamptz,
    last_success_at timestamptz,
    last_error_code text,
    consecutive_failures integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_events (
    dedupe_key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
