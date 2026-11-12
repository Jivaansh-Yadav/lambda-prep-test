# InstaRevision PDF signed links

Extramarks' "Revision Notes" (InstaRevision) chapter PDFs live in a private
Google Cloud Storage bucket (`gs://em_content_private`). They can't be linked
to directly or forever — Google Cloud Storage V4 signed URLs have a hard
**7-day maximum expiry**, no matter what's requested. There is no way to get
a non-expiring direct link from Extramarks for this content.

This is handled as a two-step pipeline so the weekly refresh never needs a
login token:

## 1. `discover-insta-revision-sources.mjs` (manual, occasional)

Crawls every subject/chapter across ICSE IX/X and ISC XI/XII and records the
GCS folder path + title of each chapter's Revision Notes PDF into
`src/data/insta-revision-sources.json`. Folder paths don't change once a PDF
is uploaded, so this file has no expiry and is committed to the repo.

Needs a short-lived Extramarks teacher-login token (`EXTRAMARKS_TOKEN`,
~60min JWT) — get it by logging into the Extramarks teacher app in a browser
and reading `JSON.parse(localStorage.extramarks_user).access_token`. Re-run
this manually only when new chapters/subjects/PDFs are added on Extramarks:

```
EXTRAMARKS_TOKEN=... node discover-insta-revision-sources.mjs
```

## 2. `generate-insta-revision-links.mjs` (automated, weekly)

Reads the committed `insta-revision-sources.json` and generates a fresh
7-day GCS signed URL for every recorded PDF, writing
`scripts/drive-crawl/output/insta-revision-links.json` (gitignored build
artifact). Needs **no login token** — only the
static Extramarks upload-service Basic credential baked into the script —
so this is the step the GitHub Actions workflow (`update-resources.yml`)
runs every week to keep links from expiring:

```
node generate-insta-revision-links.mjs
```

## Output shape

```json
{
  "generatedAt": "...",
  "expiresAt": "... (7 days after generatedAt)",
  "classes": {
    "ICSE - X": {
      "Physics": {
        "Force": [{ "name": "Force", "link": "https://storage.googleapis.com/...&X-Goog-Expires=604800..." }]
      }
    }
  }
}
```

If the weekly Action is ever skipped for more than 7 days, the links in
the signed links in `doxxmarks_resources.json` will 403. Re-running
`generate-insta-revision-links.mjs` (no token needed) immediately fixes it.
