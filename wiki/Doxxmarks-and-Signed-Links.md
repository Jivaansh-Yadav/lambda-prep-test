# Doxxmarks and signed links

Doxxmarks is the chapter-wise layer of the portal: classes → subjects → chapters → **revision notes** (PDFs) and **interactive classes / concept videos**. It is a different content shape from the class catalogues, and its PDF links are the only part of the site that expires.

## The dataset

`src/data/doxxmarks_resources.json` is the single committed source of truth for Doxxmarks. Its shape:

```
{
  "classes": [
    {
      "board": "ICSE", "roman": "X", "slug": "icse-10",
      "subjects": [
        {
          "name": "Biology",
          "chapters": [
            {
              "name": "Genetics - Some Basic Fundamentals",
              "revisionNotes": [ { "title", "url", "expiresAt" } ],
              "videos": [ … ],
              "interactive": [ … ]
            }
          ]
        }
      ]
    }
  ]
}
```

Two rules that must not be broken:

1. **This file is the only place signed links live.** There used to be a second committed manifest (`insta-revision-links.json`) holding the same expiring URLs; it drifted, then two copies were stale in different ways. The manifest is now a gitignored build artifact and the links exist only here.
2. **It is written by the pipeline, not by hand** — for the `revisionNotes` array. The chapter skeleton (names, order) is hand-structured and stable; only the URLs rotate.

## Why the links expire, and why that is fine

The PDFs are not on Google Drive. They are served out of `gs://em_content_private` as **GCS V4 signed URLs** obtained from the content service's signing endpoint. GCS caps V4 signatures at **7 days** (`604800` seconds) — the hard limit, not a choice.

So every 7 days the URLs must be re-signed, or revision notes start returning `403`. The pipeline runs weekly for exactly this reason; a missed week is visible as broken notes, not as a build failure.

## The two steps

```
generate-insta-revision-links.mjs   reads src/data/insta-revision-sources.json
                                    → signs every chapter PDF
                                    → writes scripts/drive-crawl/output/insta-revision-links.json (gitignored)

apply-insta-revision-links.mjs      reads that manifest
                                    → matches each entry into doxxmarks_resources.json
                                    → rewrites each chapter's revisionNotes in place
```

Both run inside the workflow as `[InstaRevision]` steps, after `[Datasets]` and before `[Commit]`.

### Matching key

`(board, class roman, subject name, normalised chapter name)`

- `insta-revision-sources.json` stores Drive folder labels like `ICSE - X` / `ISC - XI`; the apply step maps those to `(board, roman)` first.
- Chapter names are normalised (lowercased, punctuation collapsed) before comparison, so `Genetics – Some Basic Fundamentals` in Drive still matches `Genetics - Some Basic Fundamentals` in the dataset.
- Unmatched entries are **reported, not fatal**: a chapter added in Drive but missing from the curriculum prints a warning and is skipped. Failing the whole run because one chapter name changed would take the entire site's dataset refresh down with it.
- A fixed chapter whose subject does not exist for that class simply never matches — e.g. an ISC XII “Physics” fixture will match zero chapters, because ISC XII subjects are Biology, Chemistry, English Language, Literature in English, Geography, Hindi, and so on.

### `expiresAt`

Every link carries its own ISO timestamp. Nothing in the UI schedules on it today; it exists so a future job can warn before the cliff, and so a broken link can be told apart from a missing one in a bug report.

## Rendering

- **`/doxxmarks`** — `class` (slug), `subject` (display name), `chapter` and `note` are **indices**, not names. A share link therefore looks like `?class=icse-10&subject=Biology&chapter=0&note=0` and stays valid as long as the chapter order is stable.
- **`note-pdf-watch.tsx`** — the note viewer. The PDF is embedded as an `<iframe>` pointing straight at the signed URL, with an overlay toolbar (open in new tab, copy link, share) positioned top-left so it never sits under the frame's own chrome.
- **`doxx-watch.tsx`** — the lesson player: `@videojs/react` with an HLS source, plus a playlist of the chapter's other lessons.
- **Fullscreen** — the player and the PDF viewer both need fullscreen from inside a framed document. That is why `Permissions-Policy` in `src/server.ts` lists `fullscreen=(self "https://mscontent-gcp.extramarks.com" "https://drive.google.com")` instead of `fullscreen=()`, and why `_headers` carries the same value.
- **Sandboxing** — embedded third-party frames are sandboxed, but PDF viewers need `allow-same-origin` to render at all; removing it produces a blank white frame (this was a real regression, see the Resources section of the runbook).

## CSP consequences

`frame-src` must include:

| Origin | Used for |
| --- | --- |
| `https://drive.google.com` | Drive-hosted PDFs in the resource viewer |
| `https://mscontent-gcp.extramarks.com` | Interactive classes and lesson video |
| `https://storage.googleapis.com` | The signed InstaRevision PDFs |

Adding a fourth embed origin means editing **both** `CONTENT_SECURITY_POLICY` in `src/server.ts` and `public/_headers`, or the iframe works in dev (where the worker header wins) and breaks behind the static host — or the reverse.

## Regenerating the source list

`discover-insta-revision-sources.mjs` is the manual step that rebuilds `insta-revision-sources.json` when the Doxxmarks folder tree changes (new class, renamed subject, new chapter PDFs). It walks the Drive tree, resolves each chapter's PDF folder path, and writes the committed source list. Run it by hand, review the diff, commit — it is deliberately *not* in the weekly workflow, because a rename in Drive would otherwise silently rewrite the curriculum mapping.

Only the *discovery* step needs a login. `generate-insta-revision-links.mjs` runs on the upload service's `Basic` credential, which is why the weekly Action can re-sign every PDF without a human in the loop. That credential is read from Neon's `insta_revision_integration` row (`scripts/drive-crawl/neon-config.mjs`), not from source — it grants signed links into a private bucket, so it is a secret in the same sense the Drive key is. `apply-insta-revision-links.mjs` only rewrites JSON and needs no credential at all.

### Getting `EXTRAMARKS_TOKEN`

The discovery script authenticates as a teacher, so it needs a short-lived JWT (~60 min) that cannot be minted server-side:

1. Log into the Extramarks teacher app in a browser.
2. In the devtools console: `JSON.parse(localStorage.extramarks_user).access_token`.
3. Run `EXTRAMARKS_TOKEN=... node discover-insta-revision-sources.mjs` from `scripts/drive-crawl/`.

The token is never committed and never enters Actions — re-run discovery only when the folder tree itself changed.

## The intermediate manifest

`generate-insta-revision-links.mjs` writes `scripts/drive-crawl/output/insta-revision-links.json`, which is **gitignored** — stale links in the repo are the failure mode described above, so the only committed signed URLs are the ones `apply-insta-revision-links.mjs` just wrote into `doxxmarks_resources.json`.

```json
{
  "generatedAt": "…",
  "expiresAt": "… (generatedAt + 7 days)",
  "classes": {
    "ICSE - X": {
      "Physics": {
        "Force": [{ "name": "Force", "link": "https://storage.googleapis.com/…&X-Goog-Expires=604800…" }]
      }
    }
  }
}
```

Keys are Drive folder labels (`ICSE - X`, `ISC - XI`), which the apply step maps onto `(board, roman)` — that mapping is the reason the two files can drift apart without either one looking wrong.

## When a week is missed

If the weekly run skips more than 7 days, the notes return `403` rather than disappearing: `.pdf` links that were fresh yesterday are signed with yesterday's key. Re-running `generate-insta-revision-links.mjs` (no token) and `apply-insta-revision-links.mjs` fixes it immediately; triggering `update-resources.yml` does both. Diagnosing a *persistent* `403` after a fresh re-sign is covered in the [Operations-Runbook](Operations-Runbook) — at that point the Drive-side PDF has usually moved, which is a discovery problem, not an expiry problem.
