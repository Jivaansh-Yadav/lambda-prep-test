<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:04070f,55:101c33,100:3b82f6&height=235&section=header&text=%CE%9B%20Lambda%20Prep&fontSize=44&fontColor=eaf2ff&fontAlignY=40&desc=Four%20classes.%20One%20catalogue.%20A%20backend%20that%20remembers.&descSize=17&descAlignY=62&animation=twinkling" alt="Lambda Prep" width="100%">

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=500&size=19&duration=3200&pause=900&color=60a5fa&center=true&vCenter=true&width=700&lines=ICSE%209%2C%20ICSE%2010%2C%20ISC%2011%2C%20ISC%2012%20%E2%80%94%20CISCE%20and%20community;Ratings%2C%20views%2C%20downloads%20and%20shares%20in%20Postgres;A%20five-step%20data%20pipeline%20that%20refuses%20to%20ship%20half%20a%20crawl" alt="Typing animation" />

<br />

<img src="https://img.shields.io/badge/Status-private%20build-3b82f6?style=flat-square&labelColor=04070f" alt="Private build" />
<img src="https://img.shields.io/badge/License-proprietary-64748b?style=flat-square&labelColor=04070f" alt="Proprietary" />
<img src="https://img.shields.io/badge/Stack-TanStack%20Start%20%2B%20React%2019-60a5fa?style=flat-square&labelColor=04070f" alt="TanStack Start and React 19" />
<img src="https://img.shields.io/badge/Data-Neon%20Postgres-38bdf8?style=flat-square&labelColor=04070f" alt="Neon Postgres" />

</div>

<br />

<div align="center">

<sub><b>Not deployed, not open source.</b> This is the private product build — the repository where the resource portal grew a database, a moderation surface and a data pipeline. Everything below describes what the code does, so it can be picked up again without re-reading it.</sub>

</div>

---

<div align="center">

## What it is

</div>

A multi-class study platform: **ICSE 9, ICSE 10, ISC 11 and ISC 12**, each with two separate catalogues — **CISCE** (what the board publishes) and **Community** (what students contribute) — plus a **Doxxmarks** section for InstaRevision PDFs that hang off the same Drive root.

Where the earlier portals were static catalogues, this one is a product. Every file has a rating, a view count, a download count and a share action that persist across sessions. The landing page ranks an **Editor's Choice** from those ratings instead of showing whatever the crawler found first. And a passcode-protected admin panel lets the owner attach a Drive folder, pull its analytics, and refresh the catalogue without touching a spreadsheet.

<div align="center">

<sub>Built on <b>TanStack Start</b> — file-based routes, server functions in the same file tree, and streaming SSR — with <b>Neon</b> as the only durable store.</sub>

</div>

---

<div align="center">

## The routes

</div>

<ul>
<li><b><code>/</code></b> — the landing page: four class cards, Editor's Choice, counts per class, and the search entry point.</li>
<li><b><code>/classes/$classId</code></b> — one class: its two catalogues, subject manifest, and the subject cards in <b>Featured first, then A–Z</b> order.</li>
<li><b><code>/resources</code></b> — the browse surface, with <code>/resources/cisce</code> and <code>/resources/community</code> as source-scoped views over the same component.</li>
<li><b><code>/doxxmarks</code></b> — the InstaRevision library, a different content shape from the class catalogues.</li>
<li><b><code>/contribute</code></b> — the student submission form, including feedback and contact server functions.</li>
<li><b><code>/admin</code></b> — passcode-gated: attach Drive folders, read usage, moderate what came in.</li>
<li><b><code>/sitemap[.]xml</code></b> — a real route, generated from the same manifests the UI uses.</li>
</ul>

<div align="center">

## What is inside

</div>

<ul>
<li><b>Editor's Choice</b> — computed from per-file ratings, so the top of the homepage changes as students rate. No hardcoded curation to rot.</li>
<li><b>Four engagement counters</b> — ratings, views, downloads and shares, each written through its own server function so the write paths stay independent and a noisy counter cannot slow down a rating.</li>
<li><b>Virtualised grids</b> — <code>@tanstack/react-virtual</code>, because a group can hold hundreds of files and rendering them all makes a phone crawl.</li>
<li><b>Fuzzy search</b> — Fuse.js over the active catalogue, with the index scoped to the class you are looking at rather than the whole platform.</li>
<li><b>Real media playback</b> — <code>@videojs/react</code> with an HLS source, so recorded lectures play in place instead of opening a new tab.</li>
<li><b>Passcode admin</b> — a Drive folder can be attached to a class from the UI; the analytics the admin sees are Cloudflare's, cached in Postgres so the dashboard opens instantly.</li>
<li><b>Bilingual UI</b> — one i18n module with <code>en-US</code> and <code>zh-CN</code> keys; no hardcoded strings in components.</li>
<li><b>Theme with no flash</b> — an inline bootstrap script sets the class on <code>&lt;html&gt;</code> before paint.</li>
<li><b>Error capture</b> — client errors are posted to a server route with the route path and a hash of the visitor, so a broken page is reportable without a third-party SDK.</li>
</ul>

---

<div align="center">

## Stack

</div>

<ul>
<li><b>TanStack Start + React 19</b> — SSR, server functions, and route-level data loading without a separate API tier.</li>
<li><b>Vite 8 + Tailwind CSS 4</b> — the CSS-first config, not a JavaScript one.</li>
<li><b>@neondatabase/serverless</b> — HTTP driver over Postgres; works from an edge runtime, no connection pool to babysit.</li>
<li><b>Drizzle-style typed schema in <code>src/lib/db.ts</code></b> — one place that knows every table and every counter increment.</li>
<li><b>Vitest</b> — unit tests next to the code, <code>vitest run</code> in CI.</li>
<li><b>Node + Python for the pipeline</b> — the crawler is Node, the transforms are Python; the orchestrator is a Node script that shells out to both.</li>
</ul>

<div align="center">

<img src="https://skillicons.dev/icons?i=react,ts,vite,tailwind,postgres,nodejs,py,git" alt="React, TypeScript, Vite, Tailwind, Postgres, Node, Python, Git" />

</div>

---

<div align="center">

## Under the hood

</div>

<details>
<summary><b>The five-step pipeline</b> — one command, fail-fast, never half-updated</summary>

<br />

<p><code>node scripts/generate-all-resources.js</code> runs the whole refresh in order:</p>

<ol>
<li><b>Drive crawl</b> → <code>scripts/drive-crawl/output/&lt;class&gt;/{cisce,community}.json</code> for all four classes, plus <code>doxxmarks.json</code>. The Doxxmarks crawl has its own exponential-backoff retries because it walks one very large root.</li>
<li><b>Transform</b> → <code>src/data/resources-{cisce,community}-&lt;class&gt;.json</code>, and it rewrites <code>doxxmarks_resources.json</code>'s chapter <code>revisionNotes</code> from the Doxxmarks PDFs.</li>
<li><b>Split</b> → any dataset past the size threshold becomes a sharded directory instead of one file.</li>
<li><b>Sort</b> → every <code>manifest.json</code> gets its subjects in Featured-first, then A–Z order.</li>
<li><b>Count</b> → <code>resource-counts.json</code>, the single source for every number the UI prints.</li>
</ol>

<p>Any step failing aborts the run. <code>--skip-crawl</code> reuses the last crawl output, which is what makes iterating on the transforms cheap without lying about freshness.</p>

</details>

<details>
<summary><b>Sharding is a data decision, not a build trick</b></summary>

<br />

<p>A catalogue that loads as one JSON file is fine at 500 entries and painful at 5,000: the whole payload blocks the first render, and a single typo invalidates every cached copy. Step 3 splits by subject once a dataset crosses the threshold, and the manifest keeps the map from subject to shard. The route then fetches only the shard the student opened.</p>

<p>This is why the crawl output, the transformed data and the runtime fetch all agree on one folder shape — the split is upstream of the UI, so nothing at render time has to guess.</p>

</details>

<details>
<summary><b>Why counters live in Postgres and not in a client</b></summary>

<br />

<p>Views and downloads on a study portal are the only honest signal of which paper is actually useful, and a client-side counter is a counter you cannot trust or aggregate. Each interaction hits a server function that increments one column and returns the new value, so the number a student sees is the number everyone else sees.</p>

<p>Ratings go further: they are stored per visitor, which is what makes Editor's Choice resistant to one enthusiastic classmate clicking five stars repeatedly.</p>

</details>

<details>
<summary><b>The admin panel is deliberately small</b></summary>

<br />

<p>Passcode in, then three things: attach a Drive folder to a class, read the Cloudflare analytics cache, review submissions. Caching the analytics in Postgres rather than querying Cloudflare on every page load keeps the panel usable when the analytics API is slow — which, in practice, is most of the time.</p>

<p>It is not a CMS. Content still comes from Drive, because that is where the class already keeps it.</p>

</details>

---

<div align="center">

## Project structure

</div>

<pre><code>lambda-prep-test/
├── src/routes/                 # __root · index · classes.$classId · resources[.cisce|.community]
│                               # doxxmarks · contribute · admin · sitemap[.]xml
├── src/lib/                    # db · lambda brand · i18n · theme · utils
├── src/data/                   # doxxmarks_resources.json · resources-*.json · manifests · resource-counts.json
├── scripts/
│   ├── generate-all-resources.js     # the 5-step orchestrator
│   ├── drive-crawl/generate-drive-json.js
│   ├── transform-resources.py
│   ├── split-resources-dataset.py
│   ├── sort-manifest-subjects.py
│   └── count-resources.py
└── tests/                      # vitest</code></pre>

---

<div align="center">

## Run it

</div>

<pre><code>git clone https://github.com/Jivaansh-Yadav/lambda-prep-test.git
cd lambda-prep-test
npm install
npm run dev            # vite dev on :3000
npm test               # vitest run</code></pre>

<p>Needs <code>DATABASE_URL</code> (Neon) and a Google service account for the crawler. Without a database the catalogue renders but every counter, rating and admin action is inert — that is the intended degraded state, not a crash.</p>

<div align="center">

<sub>Proprietary source. No licence is granted for reuse, redistribution or deployment.</sub>

</div>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:04070f,55:101c33,100:3b82f6&height=110&section=footer&reversal=true" alt="" width="100%">
