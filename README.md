<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:04070f,55:101c33,100:3b82f6&height=235&section=header&text=%CE%9B%20Lambda%20Prep&fontSize=44&fontColor=eaf2ff&fontAlignY=40&desc=Four%20classes.%20One%20catalogue.%20A%20pipeline%20that%20refreshes%20itself.&descSize=17&descAlignY=62&animation=twinkling" alt="Lambda Prep" width="100%">

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=19&duration=3200&pause=900&color=60a5fa&center=true&vCenter=true&width=760&lines=ICSE%209%2C%20ICSE%2010%2C%20ISC%2011%2C%20ISC%2012%20%E2%80%94%20CISCE%20and%20community;Ratings%2C%20views%2C%20downloads%20and%20shares%20in%20Postgres;A%20weekly%20GitHub%20Actions%20refresh%20you%20can%20watch%20step%20by%20step" alt="Typing animation" />

<br />

<a href="https://lambda-prep.pages.dev"><img src="https://img.shields.io/badge/Live-lambda--prep.pages.dev-3b82f6?style=flat-square&labelColor=04070f" alt="Live site" /></a>
<img src="https://img.shields.io/badge/License-proprietary-64748b?style=flat-square&labelColor=04070f" alt="Proprietary" />
<img src="https://img.shields.io/badge/Stack-TanStack%20Start%20%2B%20React%2019-60a5fa?style=flat-square&labelColor=04070f" alt="TanStack Start and React 19" />
<img src="https://img.shields.io/badge/Data-Neon%20Postgres-38bdf8?style=flat-square&labelColor=04070f" alt="Neon Postgres" />
<img src="https://img.shields.io/badge/Host-Cloudflare%20Pages-f6821f?style=flat-square&labelColor=04070f" alt="Cloudflare Pages" />

</div>

<br />

<div align="center">

<sub><b>Public site, proprietary source.</b> <a href="https://lambda-prep.pages.dev">lambda-prep.pages.dev</a> is the product; this repository is the code behind it. The README is the summary — every subsystem has a page in the <a href="https://github.com/Jivaansh-Yadav/lambda-prep/wiki">wiki</a>, and the wiki source is versioned in <code>wiki/</code>.</sub>

</div>

---

## What it is

Lambda Prep is a study-resource portal for **ICSE 9, ICSE 10, ISC 11 and ISC 12**. Each class carries two separate catalogues — **CISCE** (what the board publishes) and **Community** (what students contribute) — plus a **Doxxmarks** area where chapter revision notes and video lessons hang off the same Drive root.

Every file has a rating, a view count, a download count and a share action that persist across sessions. The landing page ranks **Editor's Choice** from those ratings rather than a hand-written list, so the top of the homepage follows what students actually open.

Content is not uploaded by hand. A **weekly GitHub Actions run** re-crawls Google Drive, rebuilds every JSON dataset, re-signs the Doxxmarks PDF links, and commits the result. The admin panel can trigger the same run and shows it progressing **category by category** while it happens.

---

## The routes

| Route | What it does |
| --- | --- |
| `/` | Landing page: four class cards, Editor's Choice, per-class counts |
| `/classes/$classId` | One class, its two catalogues, subjects in Featured-first then A–Z order |
| `/resources` | Browse surface; `/resources/cisce` and `/resources/community` scope it |
| `/doxxmarks` | Chapter-wise InstaRevision library: classes → subjects → chapters → notes |
| `/contribute` | Student submission form, plus contact and feedback server functions |
| `/admin` | Passcode-gated dashboard: analytics, dataset pipeline, moderation |
| `/sitemap.xml` | Real route; a hand-kept entry table (path, priority, `lastmod`), `<loc>` built from `SITE_URL` |
| `/drive` | 302 → the public Google Drive root |
| `/github` | 302 → this repository |

---

## What is inside

- **Editor's Choice** — computed from per-file ratings; no curation list to rot.
- **Four engagement counters** — ratings, views, downloads, shares, each with its own server function so a noisy counter cannot slow a rating down.
- **Virtualised grids** — `@tanstack/react-virtual`; a group can hold hundreds of files.
- **Fuzzy search** — Fuse.js, indexed per class rather than platform-wide.
- **Real media playback** — `@videojs/react` with an HLS source; lectures play in place.
- **Doxxmarks player** — chapter lessons and PDF revision notes embedded, with a playlist and a fullscreen-safe toolbar.
- **Passcode admin** — analytics KPIs, a live pipeline tracker, Drive folder attachment, contribution and message moderation.
- **Bilingual UI** — one i18n module (`en-US`, `zh-CN`); no hardcoded strings in components.
- **Short links** — `/drive` and `/github`, handled both at the edge (`_redirects`) and in the SSR entry.

---

## The pipeline

`.github/workflows/update-resources.yml` runs every Monday at 03:00 UTC, or on demand from the admin panel. Every step name carries a `[Category]` tag, which is what turns a flat Actions log into the grouped progress view inside the dashboard.

```
[Setup]         checkout · node · python · Drive credentials · crawl deps
[Crawl]         generate-drive-json.js        → output/<class>/{cisce,community}.json
[Datasets]      transform-resources.py        → src/data/resources-*.json
                split-resources-dataset.py    → sharded datasets per subject
                sort-manifest-subjects.py     → Featured first, then A–Z
                count-resources.py            → resource-counts.json
[InstaRevision] generate + apply signed links → doxxmarks_resources.json
[Commit]        drop credentials · diff summary · commit + push
```

Fail-fast by design: a failed crawl aborts before anything is transformed, so a dataset is never half-updated. A `concurrency` group stops two runs racing the same files, and a 30-minute job timeout stops a hung crawl burning the default six hours.

---

## Stack

TanStack Start · React 19 · Vite 8 · Tailwind CSS 4 · `@neondatabase/serverless` over Neon Postgres · Nitro (Cloudflare target) · Vitest · Node + Python for the pipeline.

---

## Project structure

```
lambda-prep/
├── src/routes/                 # index · classes.$classId · resources[.cisce|.community]
│                               # doxxmarks · contribute · admin · sitemap[.]xml
├── src/lib/                    # db · brand · i18n · redirects · workflow-progress
│                               # *-server.ts: admin, drive, github, ratings, views…
├── src/data/                   # doxxmarks_resources.json · resources-*.json · manifests
├── scripts/
│   ├── generate-all-resources.js     # local 5-step orchestrator
│   ├── drive-crawl/                  # Drive crawler + InstaRevision link signing
│   ├── transform-resources.py
│   ├── split-resources-dataset.py
│   ├── sort-manifest-subjects.py
│   └── count-resources.py
├── public/                     # _headers · _redirects · og · robots.txt
└── .github/workflows/          # update-resources.yml
```

---

## Run it

```bash
git clone https://github.com/Jivaansh-Yadav/lambda-prep.git
cd lambda-prep
bun install
bun run dev      # vite dev on :3000
bun run test     # vitest
```

Needs `DATABASE_URL` (Neon) for counters, ratings and admin, plus `ADMIN_PASSCODE` to open `/admin` at all. Without them the catalogue still renders — counters and admin actions report "not configured" instead of crashing.

## Deploy it

```bash
bun run build:pages    # cloudflare-pages preset → dist/ (_worker.js + static assets)
```

Cloudflare Pages: build command `bun run build:pages`, output directory `dist`, compatibility flag `nodejs_compat`. The plain `bun run build` stays on the `cloudflare-module` Workers target for other hosts.

---

<div align="center">

## Documentation

<b>This README is the map. The wiki is the territory.</b> Pages live in the wiki and are versioned in <code>wiki/</code>; <code>scripts/push-wiki.sh</code> publishes them.

</div>

| Wiki page | Covers |
| --- | --- |
| [Architecture](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Architecture) | Request path, SSR entry, routing, data loading, error handling |
| [Resource-Pipeline](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Resource-Pipeline) | Every crawl/transform step, sharding rules, failure modes |
| [Doxxmarks-and-Signed-Links](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Doxxmarks-and-Signed-Links) | Chapter curriculum, GCS signed URLs, the 7-day rotation |
| [Admin-and-Analytics](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Admin-and-Analytics) | Passcode gate, KPIs, category-grouped run tracker |
| [Database](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Database) | Tables, counter semantics, cache tables, degraded mode |
| [Deployment](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Deployment) | Cloudflare Pages build, headers, env vars, DNS |
| [SEO-and-Short-Links](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/SEO-and-Short-Links) | Canonical URL, sitemap route, OG images, `/drive` + `/github` |
| [Operations-Runbook](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Operations-Runbook) | Weekly refresh, what breaks and how to fix it |
| [Contributing](https://github.com/Jivaansh-Yadav/lambda-prep/wiki/Contributing) | Local setup, conventions, test expectations |

---

<div align="center">

<sub>Proprietary source. No licence is granted for reuse, redistribution or deployment.</sub>

</div>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:04070f,55:101c33,100:3b82f6&height=110&section=footer&reversal=true" alt="" width="100%">
