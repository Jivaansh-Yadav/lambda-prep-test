# Lambda Prep — wiki

Lambda Prep is a study-resource portal for **ICSE 9, ICSE 10, ISC 11 and ISC 12**. It serves two catalogues per class — **CISCE** (board material) and **Community** (student-contributed) — plus a **Doxxmarks** library of chapter revision notes and video lessons.

- **Live site:** https://lambda-prep.pages.dev
- **Repository:** https://github.com/Jivaansh-Yadav/lambda-prep
- **Canonical origin:** `https://lambda-prep.pages.dev` (`SITE_URL` in `src/lib/lambda-prep.ts`)

The repository README is the summary. This wiki is the detailed reference: one page per subsystem, written so the code can be picked up a year from now without re-reading it.

## How the pieces fit

```
Google Drive root
  └── weekly GitHub Actions run
        ├── crawl       → scripts/drive-crawl/output/<class>/{cisce,community}.json
        ├── transform   → src/data/resources-{cisce,community}-<class>.json (+ shards)
        ├── sign        → doxxmarks_resources.json  (GCS URLs, 7-day rotation)
        └── commit      → push to main → Cloudflare Pages rebuild
Cloudflare Pages
  └── TanStack Start SSR (src/server.ts)  →  Neon Postgres (counters, admin, caches)
```

Nothing content-shaped is written by hand. The datasets in `src/data/` are build products of the pipeline; the only hand-maintained data is the curriculum skeleton (classes → subjects → chapters) that the signed links and lesson videos hang off.

## Pages

| Page | Read this when |
| --- | --- |
| [Architecture](Architecture) | You need to understand the request path, SSR entry, security headers, routing or data loading |
| [Resource-Pipeline](Resource-Pipeline) | You are changing the crawler, a transform, sharding, or the CI workflow |
| [Doxxmarks-and-Signed-Links](Doxxmarks-and-Signed-Links) | Revision notes 403, or the chapter dataset needs changing |
| [Admin-and-Analytics](Admin-and-Analytics) | You are touching the passcode gate, the dashboard cards or the run tracker |
| [Database](Database) | You are adding a counter, a cache, or an integration row |
| [Deployment](Deployment) | You are shipping, moving hosts, or debugging a Pages build |
| [SEO-and-Short-Links](SEO-and-Short-Links) | Canonical tags, sitemap, OG images, `/drive`, `/github` |
| [Operations-Runbook](Operations-Runbook) | Something is broken in production right now |
| [Contributing](Contributing) | Local setup, conventions, tests, code style |

## Conventions used in this wiki

- Paths are relative to the repository root unless stated otherwise.
- “Dataset” means one of the committed JSON files under `src/data/`, produced by the pipeline.
- “Catalogue” means a UI surface: a class page, the resources browser, or Doxxmarks.
- Anything labelled **temporary** is intentional and explained where it appears — do not “clean it up” without reading the note.
