# WorldStatus

**Is it down everywhere, or just where you are?**

WorldStatus checks any website from real internet connections around the world (home broadband,
mobile and data-center networks in dozens of countries) and tells you **where** it fails and
**why**. For example: *"Unreachable from Pakistan, working elsewhere. Most common result: Domain not
found. This network's DNS says the domain doesn't exist."*

Every site gets a public, shareable page at `/status/<domain>` with the latest results, a world
map, per-probe details and a filterable history (country, city, ISP, network type, date range).

This is **Phase 1 (MVP)**: on-demand checks, diagnosis, public status pages and history.
See [Roadmap](#roadmap) for what comes next.

---

## How it works

```
Browser ──POST /api/checks──▶ Next.js API ──▶ Globalping API (probes worldwide)
   │                              │  validate URL, SSRF check, dedupe,
   │                              │  rate limit, probe budget
   │                              ▼
   └──GET /api/checks/:id──▶ poll (throttled) ─▶ classify each probe ─▶ Postgres
                                                  (diagnosis + analysis)
```

1. **Probes.** Measurements run on the [Globalping](https://globalping.io) network: thousands of
   probes with country, city, ASN/ISP and "eyeball" (home/mobile) vs data-center tags. We send an
   HTTP `GET` (first 10 KB of the body is returned, so block pages can be recognised).
2. **Per-step diagnosis** (`src/lib/diagnosis.ts`). Each probe result is classified as
   up / down / degraded / inconclusive, with the failed step (DNS → TCP → TLS → HTTP) and a specific
   cause, for example:
   - DNS: domain not found, resolver failure, **private/sinkhole answer** (the usual ISP block method)
   - TCP: timeout, refused, unreachable
   - TLS: handshake failure, **untrusted certificate** (possible interception)
   - Connection reset mid-way (typical of DPI filtering)
   - HTTP: 5xx, 403, **451 legal block**, **Cloudflare country ban (error 1009)**, government/ISP
     **block pages**, redirects to block pages, bot challenges (counted as reachable)
   - Probe-side failures are **inconclusive** and never counted as downtime.
3. **Analysis** (`src/lib/analysis.ts`) turns results into plain-language findings: down
   everywhere (site problem) vs down in one country (regional block) vs failing on specific ISPs
   while others in the same country work (ISP-level filtering), region-only redirects, and
   countries that are much slower than the global median.
4. **History.** Every probe result is stored and can be sliced by country, city, ISP (ASN), network
   type and date range (up to 90 days per query), with a timeline and breakdown tables.

### Built for many concurrent users

- **Request collapsing.** Identical checks (same URL and locations) within `CHECK_DEDUPE_SECONDS`
  share one measurement. When a popular site goes down and thousands of people check at once, it
  costs one measurement, not thousands. Races are settled by a unique index, not by locks.
- **Throttled polling.** However many people watch a running check, the upstream API is polled at
  most once per second per check; everyone sees the same stored snapshot.
- **Exactly-once finalisation.** Results are written by whichever request wins a conditional
  `UPDATE`, so concurrent pollers never duplicate rows.
- **Rate limits and a global probe budget** are atomic Postgres counters shared by all instances.
  Unused probes and failed starts are refunded.
- **Caching.** Finished checks are immutable and cacheable (`s-maxage=86400`); history responses
  are CDN-cacheable for 30 s and bypassed right after a new check finishes.

### Safety

- Only `http`/`https` on ports 80/443; no IP literals, credentials, or private/reserved TLDs
  (`.local`, `.internal`, `.onion`…).
- Our server resolves the hostname and **refuses domains that point to private addresses**
  (SSRF defence; Globalping also refuses private targets).
- Client IPs are **never stored**: rate limiting uses an HMAC of the IP (IPv6 grouped by /64).
- Forwarding headers are only trusted when `TRUST_PROXY_HEADERS=true`.
- All external API responses are schema-validated; unknown upstream statuses degrade to
  "inconclusive" rather than crashing.

### SEO

- One canonical URL per site (`/status/example.com`); non-canonical spellings 308-redirect, and
  query strings (`?check=`, filters) point their canonical at the base page.
- Pages are **`noindex` until a site has been reached at least once and checked at least twice**,
  so junk or nonexistent hostnames never become thin indexed pages.
- `robots.txt`, and a sitemap index (`/sitemap.xml`) with 50,000-URL pages (`/sitemaps/N.xml`).
- Results are server-rendered, so crawlers see the latest status without running JavaScript.

---

## Getting started

Requirements: Node.js 20.9+ (22 recommended) and PostgreSQL 14+.

```bash
npm install
cp .env.example .env.local          # then edit DATABASE_URL and IP_HASH_SECRET
npm run db:migrate                  # uses DATABASE_URL from your shell environment
npm run dev
```

Open http://localhost:3000.

> **Globalping token.** Anonymous access is limited to 50 probes per measurement and a small
> hourly allowance per IP. Create a free account at https://dash.globalping.io and set
> `GLOBALPING_TOKEN` for real traffic, and set `GLOBALPING_HOURLY_PROBE_BUDGET` to match the
> allowance/credits you have.

### Developing without the real probe network

A mock Globalping API with realistic scenarios is included:

```bash
npm run mock:globalping             # http://127.0.0.1:4010, results after ~4 s
GLOBALPING_API_URL=http://127.0.0.1:4010 npm run dev
```

The scenario is chosen by hostname: `pk-blocked.example.org` (DNS block in Pakistan),
`isp-reset.example.org` (one Pakistani ISP resets connections), `geo-403.example.org`
(Cloudflare country ban), `down.example.org` (502 everywhere), `slow-pk.example.org`, and anything
else is up everywhere.

### Docker

```bash
IP_HASH_SECRET=$(openssl rand -hex 32) docker compose up --build
```

Starts Postgres, runs migrations, then serves the app on port 3000.

---

## Configuration

All variables are validated at startup (`src/lib/config.ts`); see `.env.example` for defaults and
details.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (required) |
| `IP_HASH_SECRET` | Secret for hashing client IPs, ≥16 chars (required) |
| `SITE_URL` | Public origin for canonical URLs, robots and sitemap |
| `GLOBALPING_TOKEN` | Globalping API token (strongly recommended) |
| `GLOBALPING_HOURLY_PROBE_BUDGET` | Max probes/hour across all instances |
| `MAX_PROBES_PER_CHECK` | Probes per check, spread across the chosen places |
| `CHECK_DEDUPE_SECONDS` | Window in which identical checks are shared |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_HOUR` | Per-client limits for starting checks |
| `TRUST_PROXY_HEADERS` | Trust `X-Forwarded-For` etc. (only behind a proxy that sets them) |
| `RESULT_RETENTION_DAYS` | Retention used by `npm run db:prune` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (no database needed) |
| `npm run test:integration` | Service tests against Postgres (`TEST_DATABASE_URL`, default `postgres://status:status@localhost:5432/status_test`) |
| `npm run test:e2e` | Browser tests: production build + mock probes (`E2E_DATABASE_URL`, run `npm run build` first) |
| `npm run db:migrate` | Apply new SQL migrations (append-only, checksum-verified, lock-protected) |
| `npm run db:prune` | Delete data past retention; schedule daily |
| `npm run mock:globalping` | Local mock of the probe network |

## API

| Endpoint | Description |
| --- | --- |
| `POST /api/checks` | Body `{ "url": "example.com", "locations": { "mode": "worldwide" } }` or `{ "mode": "custom", "locations": [{ "country": "PK", "city": "Karachi" }, { "asn": 17557 }, { "country": "US", "network": "Comcast" }], "networkType": "eyeball" }`. Returns `201 { checkId, hostname, reused }`, or `200` when an identical recent check is reused. Errors: `400`, `413`, `422` (no probes there), `429` (rate limited, with `Retry-After`), `503` (capacity), `502`. |
| `GET /api/checks/:id` | Check status (`pending` / `finished` / `failed`), classified per-probe results and analysis. Poll until not `pending`. |
| `GET /api/sites/:hostname/history` | Aggregated history. Query: `from`, `to` (ISO, ≤90 days apart), `country`, `city` (needs `country`), `asn`, `networkType`. |

## Project layout

```
migrations/            SQL migrations (append-only)
scripts/               migrate, prune, mock Globalping server
src/lib/               domain logic: target validation, SSRF, Globalping client, diagnosis,
                       analysis, checks service, history queries, rate limiting
src/app/               pages (/, /status/[hostname]), API routes, robots, sitemaps
src/components/        UI: check form, location picker, results, world map, history, charts
tests/unit|integration|e2e
```

---

## Known limitations (read before launch)

- **Probe coverage decides what you can see.** A country, city or ISP with no online Globalping
  probe is silently skipped. Very small places often have none. Neighbourhood-level results are
  not meaningful for network problems. ISP (ASN) is the level at which blocking actually differs.
- **Capacity costs money.** Each check uses up to `MAX_PROBES_PER_CHECK` probes. At scale you
  need Globalping credits (or your own probes). The hourly budget protects you from surprise usage;
  when it runs out, users get a clear "capacity reached" message and cached results still show.
- **On-demand only.** Phase 1 has no scheduled monitoring or alerts; history is built from checks
  people run.
- **Block-page detection is heuristic.** It uses specific phrases and redirect patterns. New block
  page wording will show as "up" (HTTP 200) until patterns are added.
- **No Content-Security-Policy yet.** Security headers are set, but a nonce-based CSP should be
  added before launch.

## Roadmap

- **Phase 2:** site ownership verification (DNS TXT / meta tag), scheduled checks, alerts
  (email, Slack, webhooks) when a region diverges, and an embeddable script for real-visitor data.
- **Phase 3:** crowdsourced "down for me" reports, incident pages, status badges, and moving
  per-probe results to a columnar store (ClickHouse/Timescale) once volume requires it.
