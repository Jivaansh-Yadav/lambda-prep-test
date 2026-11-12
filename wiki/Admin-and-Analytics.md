# Admin and analytics

`/admin` is a passcode-gated dashboard. It is deliberately not a CMS: content still comes from Drive, and the dashboard exists to *watch* the machine, not to author content.

## The gate

- The passcode is verified server-side by `requirePasscode()` in `src/lib/admin-server.ts`; the client never holds a hash.
- The verified passcode lives **in memory** for the session. Navigating to `/admin` with a full page load therefore logs you out; client-side navigation keeps you in. This is intentional — a passcode in `localStorage` would survive a shared machine.
- Every admin server function re-checks the passcode. The route guard is convenience; the server function is the boundary.
- `/admin` is `noindex, nofollow` and has its own title. It must never appear in the sitemap.
- Section pages are reachable by URL before unlocking (`/admin?section=analytics` is what the dashboard cards link to). A data fetch that needs the passcode therefore waits for it instead of firing with an empty string — otherwise the first render would ask the server for analytics with no credentials and the panel would report the rejection as a configuration problem.

## The dashboard

Two rows, four cards each, colour-coded by intent.

**Analytics (read-only, cool accents)**

| Card | Content |
| --- | --- |
| Page loads | Cloudflare Web Analytics page loads for the selected range |
| Visits | Unique visits for the range |
| Latest commit | `owner/repo@sha` short message — proves what production is running |
| Deep analytics | Drill-down: traffic chart, visits by section, RUM detail panel |

**Manage (actionable, warm accents)**

| Card | Content |
| --- | --- |
| Manage resources | Drive folder attachment, the dataset workflow panel, the Drive root link |
| Resource stats | Per-class/per-subject counts and rating totals |
| Contributed resources | Student submissions with approve / reject / notes |
| Contact messages | Footer messages with status and admin notes |

Each card opens a full-width section (`?section=manage|stats|contributions|messages|analytics`) rather than a modal, so a long table is scrollable on a phone and the URL is shareable.

## Analytics pipeline

Two different sources, both cached in Postgres because neither API is fast enough to call on every dashboard load:

| Source | Table | What it gives |
| --- | --- | --- |
| Cloudflare **GraphQL** analytics | `cloudflare_analytics_cache` | page loads, visits, visits by path/section |
| Cloudflare **Web Analytics (RUM)** | `cloudflare_rum_cache` | real-user visits, referrers, a fuller traffic chart |

- Cache keys include the **range** (`24h`, `7d`, `14d`, `30d`), so switching ranges does not overwrite the other three.
- Credentials live in `cloudflare_integration` (Cloudflare account id + a RUM API token with `Account → Analytics → Read`) — seeded once by hand in Neon, not in env vars.
- The **site tag** is not a secret: it ships in every page's HTML as the beacon token. It lives in code (`RUM_SITE_TAG` in `src/lib/lambda-prep.ts`) and is imported by both the beacon in `__root.tsx` and the GraphQL filters in `admin-server.ts`, so the two can never disagree. Moving domains or re-creating the Web Analytics site is one constant, one deploy.
- When nothing is configured, the panel says so and prints the exact steps to fix it, instead of showing zeroes that look like an outage.
- The RUM beacon itself is served from `static.cloudflareinsights.com`; the CSP has to allow both the script and the beacon `connect-src`, otherwise the numbers stay at zero forever (this has happened — see the runbook).

## The dataset workflow panel

The part worth reading twice.

`update-resources.yml` runs weekly. GitHub's API exposes **step status while a run is in flight**, but job logs only after it finishes. So the workflow is split into `[Category]`-tagged steps, and `src/lib/workflow-progress.ts` turns that flat step list into a grouped, friendly view.

### Categories

| Key | Label | What it covers |
| --- | --- | --- |
| `setup` | Setup | checkout, Node, Python, Drive credentials, crawl deps |
| `crawl` | Drive crawl | the Drive tree walk |
| `datasets` | Datasets | transform, split, sort, count |
| `instarevision` | InstaRevision | re-signing the 7-day PDF links |
| `commit` | Commit | secret cleanup, diff summary, commit + push |
| `runner` | Runner | GitHub's own “Set up job” / “Complete job” / `Post …` steps |
| `other` | Other | any step whose name lost its tag |

The `[Tag]` prefix wins; a light alias table (`crawl`/`drive`, `datasets`/`data`, `instarevision`/`revision`, …) absorbs reasonable renames. An untagged step still shows up, under “Other” — the panel degrades instead of breaking.

### What the panel does

1. On mount it attaches to the **newest run**, whether the admin started it or the scheduler did — so a Monday refresh is visible without anyone clicking anything.
2. It polls every **3 seconds** while a run is live, and re-renders once a second locally so elapsed time and step durations tick between polls.
3. It shows an overall progress bar, elapsed time, and an estimate of time remaining derived from completed categories, then expands into per-category rows with per-step durations and status.
4. Failure rolls up: any failed step marks its category failed, and a cancelled run does not masquerade as success.
5. Recent runs are listed with event type (`scheduled` / `manual`), conclusion, duration and a link to the GitHub run.
6. **Dispatch is guarded** — the run button is disabled while a run is queued or in progress, and the dispatch is confirmed first, so a double click cannot queue two crawls (they would collide on the same generated files; the workflow's own `concurrency` group is the second line of defence).
7. When a run finishes, the panel refreshes the Drive-derived counts so the dashboard reflects the new datasets without a reload.

### Configuration

The panel is driven by `github_integration` (single row): `pat`, `owner`, `repo`, `workflow_file`, `ref`.

> **After the rename, this row must point at the new repository:** `owner = Jivaansh-Yadav`, `repo = lambda-prep`, `workflow_file = update-resources.yml`, `ref = main`. If it still points at the old repository the panel shows “Could not reach the GitHub integration” or tracks a workflow that is no longer the live one.

The PAT only needs Actions read + dispatch on this repository. It is stored in the database, never in the bundle.

## Other admin surfaces

- **Manage resources** — a live Drive browser rooted at `drive_integration.folder_id` (not the committed JSON), with upload into the current folder, rename, and delete-to-trash. Folder/file ids are validated (`isDriveId`) before any write, and failed uploads report the Drive API's reason. It does not change which folder the weekly crawl starts from.
- **Resource stats** — totals by class and subject, average rating and rating count per file, read from the same `resource_*` tables the public counters write.
- **Contributed resources** — the queue from `/contribute`: approve, reject with a note, and the schema records `admin_notes`, `status` and `reviewed_at`.
- **Contact messages** — footer messages with the same review shape, plus optional Discord/Reddit handles.

## Design notes

- Group labels (`Analytics` / `Manage`) exist so the page reads as two decisions instead of eight equal buttons.
- Accents are semantic, not decorative: cool = look, warm = act.
- Cards are single-purpose and link-shaped; the only nested control is the run button inside Manage resources, which is why it opens a section rather than acting inline.
- Mobile-first: one column below `sm`, two at `sm`, four at `lg`. This was a real bug once — `flex-basis` on the card row made two cards overlap at 400 px.
