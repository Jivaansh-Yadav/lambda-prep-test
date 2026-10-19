# Lambda Prep — Analytics History Cron

Standalone Node.js script that runs **once a day at midnight** (server local
time), fetches **the previous day's** Cloudflare traffic totals (pageviews,
unique visitors) for the whole zone, and upserts them into the permanent
`analytics_history` table on Neon.

This is intentionally separate from the main Lambda Prep app, which deploys
to Cloudflare Workers (via Nitro) and has no persistent process to host a
`node-cron` scheduler. Run this script on any always-on host (a small VM,
a container, a Raspberry Pi, etc.) or trigger `npm run run-once` from an
external scheduler (cron, GitHub Actions scheduled workflow, etc.) instead
of using the built-in scheduler.

**This repo already ships a GitHub Actions workflow for this** —
`.github/workflows/analytics-history-sync.yml` runs `node index.mjs --once`
daily at 00:15 UTC (and supports a manual `workflow_dispatch` with an
optional `date` input for backfills). It needs three repository secrets:
`DATABASE_URL`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`. The `npm start`
long-lived scheduler below is only needed if you'd rather run this on an
always-on host instead of GitHub Actions.

## Setup

```bash
cd scripts/analytics-cron
npm install
cp .env.example .env   # fill in real values
```

Required environment variables (see `.env.example`):

- `DATABASE_URL` — Neon Postgres connection string (same database as the
  main app; must have `analytics_history` table already created).
- `CLOUDFLARE_ZONE_ID` — Cloudflare zone ID for lambda-prep's domain.
- `CLOUDFLARE_API_TOKEN` — API token with Zone → Analytics → Read scope.

## Running

**As a long-lived scheduler** (keeps the process alive, fires daily at
00:00):

```bash
npm start
```

**As a single run** (for use with an external scheduler, or for manual
backfills/testing):

```bash
npm run run-once
```

## What it stores

One row per day in `analytics_history`, with `page_path = 'ALL'`
representing the whole zone (not a per-page breakdown):

| column      | meaning                                      |
|-------------|-----------------------------------------------|
| `date`      | the day being reported (yesterday, UTC)       |
| `page_path` | always `'ALL'` — zone-wide total               |
| `pageviews` | total page views for that day                 |
| `uniques`   | total unique visitors for that day             |

Upserts use `ON CONFLICT (date, page_path) DO UPDATE`, so re-running for a
day that's already recorded (e.g. a manual backfill) safely overwrites that
day's numbers instead of erroring or duplicating rows.

## Error handling

- **Cloudflare API failures** (network error, non-2xx response, GraphQL
  `errors` field, missing/malformed data) are caught, logged with
  `console.error`, and the run is skipped for that day — the scheduler
  keeps running for the next scheduled tick rather than crashing the
  process.
- **Database failures** (connection refused, auth failure, query error)
  are likewise caught and logged; the script does not crash, and in
  `--once` mode exits with a non-zero status code so an external scheduler
  can detect and alert on the failure.
- Both error paths log enough detail (status code / Postgres error code
  and message) to debug without leaking the API token or full connection
  string.
