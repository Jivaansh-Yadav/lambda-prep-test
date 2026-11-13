# Database

Neon Postgres, reached over `@neondatabase/serverless` (HTTP driver — no TCP pool, works from an edge worker). `src/lib/db.ts` exports a `sql` client that is `null` when `DATABASE_URL` is unset, and every caller handles `null` by reporting "not configured" rather than throwing.

```ts
const databaseUrl = process.env["DATABASE_URL"];
export const sql = databaseUrl ? neon(databaseUrl) : null;
```

That single `null` check is the whole degraded mode: **the catalogue renders, the counters are inert.** That is the intended behaviour on a fresh clone without a database, and it is what makes preview environments cheap.

## Tables

### Content counters

| Table | Written by | Semantics |
| --- | --- | --- |
| `resource_ratings` | `ratings-server.ts` | One row per `(file_id, voter_id)`; a student can change their own rating |
| `resource_views` | `views-server.ts` | Increment per file open |
| `resource_shares` | `shares-server.ts` | Increment per share action / copied link |
| `resource_feedback` | `feedback-server.ts` | “Was this useful?” style notes attached to a file |
| `resource_contributions` | `contribute-server.ts` | Student-submitted resources, with `status`, `admin_notes`, `reviewed_at` |
| `contact_messages` | `contact-server.ts` | Footer contact form, same review shape plus optional social handles |

Design rules that matter:

- **No bulk seeding.** A file gets a row only after real activity. There is no “0 ratings” row per file, so the table grows with usage, not with dataset size.
- **Counters increment one column and return the new value**, so the number a student sees is the number everyone sees. A client-side counter is a counter you cannot aggregate or trust.
- **Ratings are per visitor.** There is no sign-in, so `voter_id` is a random per-browser id in `localStorage` (`voter-id.ts`) — enough to let a student see and change their own rating, and to blunt accidental double submits. It is not an identity guarantee and is not treated as one.
- **Abuse protection on every public write** (`ratings`, `feedback`, `contact`, `contribute`): a light in-memory per-IP + voter limit (e.g. `10 submissions / 10 minutes` for ratings) plus a validity check that the `file_id` actually exists in the dataset. The limiter resets on deploy and a determined attacker can rotate IPs — it exists to stop naive scripted brigading and junk rows, which is the realistic threat for a school portal.
- **Editor's Choice** is computed from these rows (`average rating`, minimum count), never from a hand-written list.

### Integrations (one row each)

| Table | Columns (abridged) | Used for |
| --- | --- | --- |
| `drive_integration` | `service_account_json`, `folder_id`, `oauth_client_id`, `oauth_client_secret`, `oauth_refresh_token` | Crawling Drive, listing a class folder, contributing uploads |
| `github_integration` | `pat`, `owner`, `repo`, `workflow_file`, `ref` | Dispatching and tracking the dataset workflow |
| `cloudflare_integration` | `account_id`, `rum_api_token` | Cloudflare GraphQL analytics + Web Analytics (RUM) |
| `insta_revision_integration` | `username`, `password` | The upload service's credential, used by the weekly job to mint 7-day signed URLs for the revision-note PDFs |

All four are **seeded by hand** in the Neon SQL editor (the admin panel only prints instructions, it has no write path) and read through a `LIMIT 1` `id = true` row — one integration of each kind per deployment, which keeps the queries trivial and the UI honest.

`cloudflare_integration` used to carry a `rum_site_tag` column. Nothing reads it: the admin analytics queries filter Cloudflare's RUM dataset by request hostname (from `SITE_URL`) instead of by site tag, precisely because a tag is bound to one hostname and silently returns zero after a domain move. The column can be dropped.

> After the rename, `github_integration` must point at `Jivaansh-Yadav/lambda-prep`. See [Admin-and-Analytics](Admin-and-Analytics).

`insta_revision_integration` has no admin UI — it is seeded by hand, like the others, and is read only by `scripts/drive-crawl/neon-config.mjs`. It exists because its credential used to be a literal in a public repository (see [Doxxmarks-and-Signed-Links](Doxxmarks-and-Signed-Links)). Only the pipeline reads it; nothing in `src/` touches it, so a missing row breaks the weekly job and nothing else.

### Caches

| Table | Key | Content |
| --- | --- | --- |
| `cloudflare_analytics_cache` | range (`24h`, `7d`, `14d`, `30d`) | GraphQL totals + visits by path |
| `cloudflare_rum_cache` | range | RUM visit series, referrers |

Both exist because Cloudflare's analytics APIs routinely take seconds, and the dashboard has to open instantly. A stale cache is preferred over a spinner, and the range is part of the key so switching ranges does not clobber the other three.

## Migrations

There is no migration runner **and no DDL in the codebase** — no `CREATE TABLE`, no `ALTER TABLE`. Every table above was created by hand in the Neon SQL editor. That is the whole schema process.

Consequences worth knowing:

- The app does **not** boot-create its own tables. A fresh database with `DATABASE_URL` set but no tables fails at query time, and the failure surfaces as a server error (the admin panel now prints it) rather than a silent "not configured" — the `sql === null` path only covers a *missing* `DATABASE_URL`.
- To add a table, write the `CREATE TABLE` in Neon first, then add the reader in the server module that owns it.
- Nothing is dropped automatically. Clean-up is a manual decision.

## Local/dev

Set `DATABASE_URL` to a Neon connection string in `.env` (or the shell) for the dev server to enable counters and admin. Without it:

- catalogues, search, Doxxmarks and sharing work;
- ratings/views/shares silently no-op;
- `/admin` reports that the integration is not configured instead of erroring.

Production sets `DATABASE_URL` in the Pages project environment (see [Deployment](Deployment)).
