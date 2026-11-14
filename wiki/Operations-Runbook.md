# Operations runbook

## Routine

| Cadence | What happens | Who |
| --- | --- | --- |
| Every Monday 03:00 UTC | `update-resources.yml` re-crawls Drive, rebuilds datasets, re-signs PDF links, commits, and Pages redeploys | automatic |
| Every ~7 days | Signed InstaRevision links expire. The weekly run is what keeps them alive — **a skipped week breaks chapter revision notes** | automatic |
| When Drive content changes | Nothing extra: the next scheduled run picks it up | creator |
| When the Doxxmarks folder tree changes | `node scripts/drive-crawl/discover-insta-revision-sources.mjs`, review the diff to `src/data/insta-revision-sources.json`, commit | creator, manual |
| Ad hoc | `/admin` → Manage resources → Update resource datasets | creator |

## Health check (2 minutes)

```bash
curl -sI https://lambda-prep.pages.dev/ | head -3                         # 200
curl -s  https://lambda-prep.pages.dev/ | grep -c 'rel="canonical"'       # 1
curl -sI https://lambda-prep.pages.dev/drive  | grep -i location         # Drive folder
curl -sI https://lambda-prep.pages.dev/github | grep -i location         # repository
curl -s  https://lambda-prep.pages.dev/sitemap.xml | head -5             # absolute URLs
```

Then open `/doxxmarks?class=icse-10&subject=Biology&chapter=0&note=0`. If the PDF loads, the dataset, the signature and the CSP are all healthy.

## Failure playbook

### Revision notes return 403 / blank frame

1. Open the link's `expiresAt` in `doxxmarks_resources.json` — if it is in the past, the weekly run has not completed.
2. Re-run the workflow (`[InstaRevision]` steps only matter, but the whole run is cheap).
3. If it fails, see “Crawl fails” below — the signing step needs the crawl-independent sources file, but the workflow order means a crawl failure stops before it.
4. If the URL is fresh and still 403s, the Drive-side PDF moved: run `discover-insta-revision-sources.mjs`, review, commit, then re-run.

### Iframe is blank but the URL works in a new tab

- PDF viewers need `allow-same-origin` in the sandbox attribute; a fully sandboxed frame renders white.
- Check `frame-src` in **both** `src/server.ts` and `public/_headers`. It must include `storage.googleapis.com` for signed PDFs, `drive.google.com` for Drive PDFs and `mscontent-gcp.extramarks.com` for interactive classes.

### Fullscreen button does nothing inside an embedded frame

`Permissions-Policy` must list the frame's origin in `fullscreen=(self "…")`. An `<iframe allow="fullscreen">` can only narrow the header policy, never widen it, so the origin has to be in `src/server.ts` **and** `public/_headers`.

### Analytics cards show zeros

1. `/admin` → Deep analytics prints whether the integration is configured.
2. Check the hostname printed under the traffic chart ("Counting … only"). The panel reads exactly one host, taken from `SITE_URL` in `src/lib/lambda-prep.ts`; if that is not the domain actually serving the app, the numbers stay empty. Fix `SITE_URL` and deploy.
3. Check the cache tables are not stuck on a stale range key.
4. Compare against the Cloudflare dashboard. The panel filters to `SITE_URL`'s hostname and drops bot traffic, so a Pages card for the same host should match within a few minutes of lag on today's bucket.

### 14d or 30d disagrees with 7d

Symptom: the long ranges report fewer page loads for a day the 7d range reports in full, sometimes losing a quiet day entirely, and the numbers never move when you refresh.

That was Cloudflare's adaptive sampling, not the cache: a single query wider than ~7 days is downsampled, so 14d/30d were asking one big question instead of three to five small ones. Both panels now read every range in ≤7-day slices (`src/lib/rum-windows.ts`) and sum per bucket, so overlapping days match to the event.

If they ever drift again:

1. Press **Refresh** in Deep analytics — it deletes that range's row from `cloudflare_analytics_cache` / `cloudflare_rum_cache` before calling Cloudflare, so a stale row cannot survive it.
2. Confirm the build includes the slicing: `grep -r "7-day slices" .output/` (or the panel footer under the traffic chart).
3. Compare the day in question against a hand-run 7-day query; if the hand-run matches the panel, the window chunking is intact and the difference is in Cloudflare's own numbers.

### Campaign sources card is empty

That card reads `campaign_visits` in Neon — the app's own table — not Cloudflare. Nothing appears until somebody arrives on a URL carrying a tag:

```
https://lambda-prep.pages.dev/?utm_source=reddit&utm_medium=post&utm_campaign=class10
```

1. Confirm the link people are clicking actually has `utm_source` (or the `?ref=` shorthand) on it — the tag has to be on the *landing* URL, since that is read once on first load.
2. One row is written per session per distinct set of tags, so the same visitor reloading is not counted twice; a second person on the same link is.
3. If the row is missing entirely, check `DATABASE_URL` — the write no-ops when it is unset, and the panel prints "could not read campaign_visits".
4. Test data can be deleted with `DELETE FROM campaign_visits WHERE campaign = 'verify'`.

### “Could not load analytics” after unlocking

The panel now prints the underlying reason. The common ones:

| Message | Cause | Fix |
| --- | --- | --- |
| `Passcode rejected` | the passcode changed (or the IP is throttled) between unlocking and the request | unlock again |
| `Cloudflare's API answered HTTP 401/403 with a non-JSON body` | RUM API token revoked, expired, or missing `Account → Analytics → Read` | mint a new token, update `rum_api_token` |
| `Could not read the cloudflare_integration row from Neon` | `DATABASE_URL` wrong/missing on this deployment, or Neon unreachable | check the Pages env var, then redeploy (env vars are baked per deployment) |
| `Web Analytics isn't configured yet` | no `cloudflare_integration` row | seed it (account id + `rum_api_token`) |

### New domain

The admin panel filters Cloudflare's RUM dataset by **request hostname** — the host in `SITE_URL` (`src/lib/lambda-prep.ts`) — not by Web Analytics site tag. So a domain move is a one-line change:

1. Change `SITE_URL` to the new origin. Sitemap, canonical link, OG tags and the analytics filter all follow it.
2. Deploy. Nothing else in Cloudflare needs to be touched: Pages reports page loads for the project hostname, so the new host starts appearing in the dataset on its own. The old host's history stays in Cloudflare — the panel simply no longer reads it.
3. Optionally clear the per-range caches so the dashboard does not keep serving pre-move numbers for up to five minutes:
   ```sql
   DELETE FROM cloudflare_analytics_cache;
   DELETE FROM cloudflare_rum_cache;
   ```

There is no beacon token to rotate. The site ships **no** hand-installed Web Analytics beacon: Cloudflare Pages collects page loads for the project's own hostname, and a hand-installed beacon only works while its site tag stays bound to the exact hostname in the page (a stale tag silently drops every event — that is what once left the panel empty). Add a snippet back only if the app is ever served from a host Cloudflare does not instrument, and remember its events then arrive under that site's own host in the dataset.

### Workflow panel says “Could not reach the GitHub integration”

The `github_integration` row is wrong or the PAT expired. Required: `owner = Jivaansh-Yadav`, `repo = lambda-prep`, `workflow_file = update-resources.yml`, `ref = main`. The PAT needs Actions read + write (dispatch) on that repository. **This row still pointing at `lambda-prep-test` is the expected breakage after the rename.**

### Crawl fails with 403

The service account lost access to the Drive root (`1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc`). Re-share the root with the service-account email, then re-run. The key itself is the `drive_integration.service_account_json` row in Neon, which `[Setup] Fetch Google Drive credentials` reads through the `DATABASE_URL` secret; if neither reaches the runner, the run fails earlier with `❌ No credentials`.

### Dataset commit looks wrong (files disappeared)

1. Read the `[Commit] Summarize dataset diff` block in the run summary — it prints `git diff --stat -- src/data`.
2. `git revert <chore commit>` and push. Pages redeploys the previous datasets in about a minute.
3. Investigate Drive: a folder rename makes the crawl skip a class, which the transform faithfully reflects.

### Two runs queued at once

Should not happen: the panel disables dispatch while a run is live, and the workflow's `concurrency` group (`cancel-in-progress: false`) serialises the rest. If it does, let them finish — the second is a no-op commit.

### Site down / needs to be taken offline

1. Cloudflare Pages → Deployments → **Rollback** to the last good build (instant), or
2. Pages → Settings → disable the deployment / add a `_redirects` catch-all, remembering that a catch-all also blocks the worker path, so `src/server.ts` needs the same rule for hosts that bypass the file.

The old Vercel deployment used a takedown redirect in both `public/_redirects` and `src/server.ts`; that mechanism was removed with the rename and replaced by the `/drive` + `/github` short links.

## Secrets to rotate

| Secret | Where | Rotation effect |
| --- | --- | --- |
| `drive_integration.service_account_json` (Neon) | DB row | Next run picks it up automatically — no secret to update |
| `insta_revision_integration` (Neon) | DB row | Next run picks it up — but only Extramarks can change the password upstream |
| `DATABASE_URL` | GitHub Actions secret | None until next run — both the Drive key and the signed-link credential are read with it |
| `DATABASE_URL` | Pages env | Requires a redeploy |
| GitHub PAT (Actions) | `github_integration` row, via `/admin` | Immediate |
| Cloudflare RUM token | `cloudflare_integration` row | Immediate, cache may serve stale numbers until it expires |

## Known follow-ups

- The InstaRevision upload credential **was** an inline `Basic` header in `generate-insta-revision-links.mjs`. It now lives in Neon's `insta_revision_integration` row. The exposure is permanent regardless: the value sat in the single squashed commit, so old objects remain fetchable by SHA, and it is not ours to rotate — only the upstream service owner can change that password. Treat it as public and assume anything the `/getSignedUrl` endpoint can mint links for (`folderPath` is a request parameter, not fixed to our chapters) is readable by whoever copied it in time.
- `public/_redirects` and `src/lib/redirects.ts` duplicate the two destinations by nature (one is static). Keep them in sync; they are two lines each.
- Dataset JSON files are large enough that GitHub diffs are unreadable. Trust the `--stat` summary in the run log, not the file diff.
