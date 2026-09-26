-- Sites: one row per monitored hostname. The public status page lives at /status/<hostname>.
CREATE TABLE sites (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hostname        text        NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  -- Denormalised counters so the status page and sitemap never scan check_results.
  finished_checks integer     NOT NULL DEFAULT 0,
  -- Set once any probe anywhere has reached the site. Pages are only indexable after this,
  -- so junk/nonexistent hostnames never end up in the sitemap.
  ever_reachable  boolean     NOT NULL DEFAULT false,
  CONSTRAINT sites_hostname_lower CHECK (hostname = lower(hostname))
);

-- Sitemap pages walk indexable sites in id order; the home page lists the latest ones.
CREATE INDEX sites_indexable_idx ON sites (id) WHERE ever_reachable;
CREATE INDEX sites_recent_idx ON sites (last_checked_at DESC) WHERE ever_reachable;

-- Checks: one row per measurement request (one Globalping measurement).
CREATE TABLE checks (
  id                      uuid        PRIMARY KEY,
  site_id                 bigint      NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  target_url              text        NOT NULL,
  -- Normalised location request (our own format, see src/lib/locations.ts).
  location_request        jsonb       NOT NULL,
  provider                text        NOT NULL DEFAULT 'globalping',
  provider_measurement_id text,
  status                  text        NOT NULL DEFAULT 'pending',
  error_code              text,
  error_message           text,
  requested_probes        integer     NOT NULL,
  probes_count            integer,
  -- Identical requests inside the same time bucket share one measurement. The bucket is
  -- nulled when a check fails so a retry can claim the slot again.
  dedupe_key              text        NOT NULL,
  dedupe_bucket           bigint,
  -- Throttles upstream polling so any number of viewers cause at most one poll per interval.
  last_polled_at          timestamptz,
  -- Latest in-progress snapshot from the provider, so every viewer sees the same live state.
  partial_results         jsonb,
  requester_hash          text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz,
  CONSTRAINT checks_status_valid CHECK (status IN ('pending', 'finished', 'failed'))
);

CREATE UNIQUE INDEX checks_dedupe_idx ON checks (dedupe_key, dedupe_bucket);
CREATE INDEX checks_site_created_idx ON checks (site_id, created_at DESC);
CREATE INDEX checks_pending_idx ON checks (created_at) WHERE status = 'pending';
-- Retention pruning (scripts/prune.ts) walks checks by age.
CREATE INDEX checks_created_idx ON checks (created_at);

-- One row per probe per check. This is the table history queries run against.
CREATE TABLE check_results (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  check_id          uuid        NOT NULL REFERENCES checks (id) ON DELETE CASCADE,
  site_id           bigint      NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
  checked_at        timestamptz NOT NULL,

  continent         text        NOT NULL,
  region            text        NOT NULL,
  country           text        NOT NULL,
  state             text,
  city              text        NOT NULL,
  asn               integer     NOT NULL,
  network           text        NOT NULL,
  latitude          double precision NOT NULL,
  longitude         double precision NOT NULL,
  -- 'eyeball' (residential/mobile ISP) or 'datacenter' or 'unknown'.
  network_type      text        NOT NULL,

  -- up | down | degraded | inconclusive (probe-side failure; excluded from availability).
  outcome           text        NOT NULL,
  failed_stage      text,
  diagnosis         text        NOT NULL,
  status_code       integer,
  resolved_address  text,
  redirect_location text,
  timing_total      integer,
  timing_dns        integer,
  timing_tcp        integer,
  timing_tls        integer,
  timing_first_byte integer,
  timing_download   integer,
  tls_authorized    boolean,
  tls_error         text,
  tls_issuer        text,
  tls_expires_at    timestamptz,
  tls_fingerprint   text,
  error_message     text,

  CONSTRAINT check_results_outcome_valid CHECK (outcome IN ('up', 'down', 'degraded', 'inconclusive')),
  CONSTRAINT check_results_network_type_valid CHECK (network_type IN ('eyeball', 'datacenter', 'unknown'))
);

CREATE INDEX check_results_check_idx ON check_results (check_id);
CREATE INDEX check_results_site_time_idx ON check_results (site_id, checked_at DESC);
CREATE INDEX check_results_site_country_time_idx ON check_results (site_id, country, checked_at DESC);
CREATE INDEX check_results_site_asn_time_idx ON check_results (site_id, asn, checked_at DESC);

-- Fixed-window counters used for per-client rate limits and the global probe budget.
-- Shared across all app instances because it lives in Postgres.
CREATE TABLE rate_limit_counters (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX rate_limit_counters_expires_idx ON rate_limit_counters (expires_at);
