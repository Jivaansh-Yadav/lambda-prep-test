<div align="center">

# λ Lambda Prep

**Study resource portal for ICSE (9–10) and ISC (11–12) students**

![TanStack Start](https://img.shields.io/badge/TanStack%20Start-1.169-FF4154?style=flat-square&logo=react&logoColor=white)
![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Radix UI](https://img.shields.io/badge/Radix%20UI-primitives-161618?style=flat-square&logo=radixui&logoColor=white)
![Neon Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?style=flat-square&logo=postgresql&logoColor=black)
![Bun](https://img.shields.io/badge/Bun-runtime-FBF0DF?style=flat-square&logo=bun&logoColor=black)
![Vercel](https://img.shields.io/badge/Vercel-deployed-000000?style=flat-square&logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/license-proprietary-red?style=flat-square)

</div>

---

## Overview

**Lambda Prep** (Lambda Education Pvt. Ltd.) is a corporate, editorial-style web portal that aggregates curated and community-sourced study material — notes, sample papers, previous-year/prelim question papers, and solutions — for ICSE Classes 9–10 and ISC Classes 11–12 (Science/Commerce/Humanities streams). It wraps the resource catalog in fast fuzzy search, a dedicated notes/reference viewer ("Doxxmarks"), syllabus pages, and a passcode-gated admin panel for catalog and Google Drive source management plus traffic analytics.

The brand mark is a Half-Life-authentic Greek lambda (λ) in a circular border with an electric-blue gradient; the visual language is deep navy / slate / white with electric-blue accents — deliberately corporate and institutional, with zero "generic AI slop" styling.

## Core features

| Area | Description |
|---|---|
| **Class hubs** | `/classes/icse-9`, `/classes/icse-10`, `/classes/isc-11`, `/classes/isc-12` — subject tiles per class/stream that drill into resource listings. |
| **CISCE resources** | Official curriculum-aligned material, one static dataset per subject. |
| **Community resources** | Crowd-sourced files grouped by source folder; large groups (dozens–hundreds of files) render in a capped grid with a **"View all"** control that switches to a virtualized scroll list for performance. |
| **Editor's Choice** | A curated, hand-picked subset of top/most-useful resources surfaced above the raw community listing, informed by ratings. |
| **Search** | Instant client-side fuzzy search (Fuse.js) across resource file names and Doxxmarks subjects/chapters, debounced for responsiveness. |
| **Doxxmarks** | Embedded notes/reference section with subject → chapter navigation. |
| **Syllabus** | Static board-syllabus reference pages per class. |
| **Ratings** | Per-file ratings persisted server-side, feeding Editor's Choice curation. |
| **Admin panel** (`/admin`, passcode-gated) | Manage the resource catalog, browse/attach Google Drive folders as sources, and view Cloudflare-sourced traffic/engagement analytics (cached in Postgres). |
| **Resource dataset pipeline** | Offline scripts crawl a Google Drive service account, transform the folder tree into structured per-subject JSON, split oversized groups, and regenerate manifests/counts consumed by the UI at build/runtime. |

## Folder structure

```
.
├── public/                        # static assets served as-is (logo, images, favicon, OG image)
├── scripts/
│   ├── drive-crawl/                # crawls the Drive service account → raw folder/file JSON tree
│   ├── analytics-cron/             # scheduled job: pulls Cloudflare Web Analytics, caches in Neon
│   ├── transform-resources.py      # raw Drive tree → per-subject community/CISCE resource datasets
│   ├── transform-isc11-resources.py
│   ├── split-resources-dataset.py  # splits oversized datasets (e.g. large community buckets)
│   ├── sort-manifest-subjects.py   # normalizes manifest subject ordering
│   ├── count-resources.py          # regenerates resource-counts.json
│   └── generate-all-resources.js   # orchestrates the full crawl → transform → split → count pipeline
└── src/
    ├── routes/                     # file-based TanStack Router routes (one file per route segment)
    │   ├── __root.tsx               # root layout: providers, header/footer, 404 + error boundaries
    │   ├── index.tsx                 # homepage
    │   ├── classes.$classId.tsx      # dynamic class hub (icse-9/10, isc-11/12)
    │   ├── resources.tsx / resources.index.tsx / resources.cisce.tsx / resources.community.tsx
    │   ├── doxxmarks.tsx              # notes/reference viewer
    │   ├── syllabus.tsx                # syllabus pages
    │   └── admin.tsx                   # passcode-gated admin dashboard
    ├── components/
    │   ├── lambda/                  # feature components: class picker, resource grids/cards, search, shell (header/footer), admin UI
    │   ├── ui/                      # shadcn/ui-style primitives on top of Radix UI
    │   └── videojs/                 # Video.js React wrapper for any embedded video
    ├── data/                        # generated resource datasets + manifests (checked in, regenerated by scripts/)
    │   ├── curriculum.json
    │   ├── resource-counts.json
    │   ├── resources-cisce-icse-10.json
    │   ├── resources-community-icse-10/     # split per-subject community datasets
    │   └── resources-community-isc-11.json
    ├── hooks/                        # shared hooks (e.g. fuzzy-search hook)
    ├── lib/
    │   ├── *-server.ts               # TanStack server functions (admin auth, ratings, Drive/GitHub integration, DB access)
    │   ├── i18n.tsx                   # i18n provider + translation keys
    │   ├── theme.tsx                   # theme provider + bootstrap script (anti-flash)
    │   ├── brand.ts / lambda.ts        # brand constants, SEO/OG metadata
    │   └── curriculum.ts / resolve-class-name.ts / resources-data.ts
    └── test/                          # Vitest setup/utilities
```

## Architecture

- **Rendering**: [TanStack Start](https://tanstack.com/start) on React 19, built on [TanStack Router](https://tanstack.com/router) for file-based routing with SSR. Routes under `src/routes/` map directly to URL segments (`resources.community.tsx` → `/resources/community`, `classes.$classId.tsx` → `/classes/:classId`, etc.).
- **Server functions**: data access and privileged operations (admin passcode check, resource ratings, Google Drive folder listing, GitHub integration lookups) live in `src/lib/*-server.ts` as TanStack Start server functions — they run server-side only and are called from route loaders/components like RPCs, keeping secrets off the client.
- **Data layer**: the resource catalog is **static generated JSON** under `src/data/`, produced offline by the pipeline in `scripts/` (Drive crawl → Python transform → split → manifest sort → count), not queried live from Drive at request time. [Neon](https://neon.tech/) serverless Postgres (`@neondatabase/serverless`, accessed via `src/lib/db.ts`) is used for the dynamic bits: ratings, admin/integration secrets, and the Cloudflare analytics cache.
- **Search**: Fuse.js runs entirely client-side over the already-loaded JSON datasets via a dedicated hook in `src/hooks/`.
- **Large-list performance**: `@tanstack/react-virtual` virtualizes community resource groups once a user expands a large group ("View all"), avoiding an unbounded DOM for groups with 100+ files while keeping normal small groups in a plain responsive grid.
- **Cross-cutting providers** (set up in `src/routes/__root.tsx`): `QueryClientProvider` (TanStack Query), `I18nProvider`, `ThemeProvider` (with an inline bootstrap script to avoid a flash of the wrong theme), plus root-level 404 and error boundaries wired to lightweight error reporting (`lovable-error-reporting.ts`).
- **Build/deploy target**: Vite 8 build via `@lovable.dev/vite-tanstack-config`, with Nitro targeting Cloudflare by default for the server bundle; the app is deployed to **Vercel** in this project's hosting setup, fronted by Eazo's deployment pipeline.
- **Analytics**: a standalone cron script (`scripts/analytics-cron/`) pulls Cloudflare Web Analytics/GraphQL data on a schedule and writes it into a Postgres cache table, which the admin dashboard reads instead of hitting Cloudflare's API on every page view.

## Tech stack

- **Framework**: TanStack Start (React 19) + TanStack Router (file-based routing, SSR, server functions) + TanStack Query.
- **Build tool**: Vite 8 with `@tanstack/router-plugin` and `@lovable.dev/vite-tanstack-config`.
- **Styling/UI**: Tailwind CSS v4, shadcn/ui-style primitives over Radix UI (`accordion`, `dialog`, `dropdown-menu`, `navigation-menu`, `tabs`, `tooltip`, etc.), `tw-animate-css`, `lucide-react` icons.
- **Search**: Fuse.js (client-side fuzzy search).
- **Virtualization**: `@tanstack/react-virtual`.
- **Database**: Neon serverless Postgres (`@neondatabase/serverless`, `@neon/config`, `@neon/env`).
- **Charts**: Recharts (admin analytics dashboards).
- **Video**: Video.js via `@videojs/react` / `@videojs/hlsjs-video`.
- **Forms/validation**: React Hook Form + Zod.
- **Testing**: Vitest, Testing Library, jsdom.
- **Linting/formatting**: ESLint (flat config, typescript-eslint), Prettier.
- **Runtime/package manager**: Bun (Node.js 18+ with npm also supported).
- **Resource pipeline**: Node.js orchestrator (`generate-all-resources.js`) + Python 3 transform/split/sort/count scripts + a Google Drive service-account crawler.
- **Deployment**: Vercel (production), Eazo-managed project/environment sync.

## Design details

- **Brand mark**: Half-Life-authentic Greek lambda (λ) inside a circular border with an electric-blue gradient; the wordmark is lowercase "lambda".
- **Palette**: clean white / slate backgrounds, deep navy as the primary dark tone, electric blue as the accent — no gradients-on-everything or generic SaaS clichés.
- **Tone**: corporate, institutional, refined-editorial. Generous whitespace, confident typography, minimal decorative chrome.
- **Navigation**: brand logo + "lambda" wordmark on the left; a direct horizontal grade selector on the right (`ICSE: IX  X  |  ISC: XI  XII`) as clickable pills straight to each class hub; quick links for Resources, Syllabus, and Sign In.
- **Homepage flow**: hero (tagline → headline → description → trust checkmarks → primary CTAs, paired with a minimal illustration) → metrics strip → "Choose Your Class" cards → "How It Works" 3-step community-sharing explainer.
- **Large resource groups**: collapsed into a normal card grid with a fade overlay and a "View all (N)" affordance by default; expanding switches to a virtualized scroll grid rather than rendering hundreds of DOM nodes up front.
- **Theming**: light/dark theme support with an inline bootstrap script in the document head to set the theme before first paint and avoid a flash of the wrong theme.
- **i18n**: all user-facing copy is routed through translation keys (`src/lib/i18n.tsx`) rather than hard-coded strings, even though the current deployment ships a single locale.

## Getting started

Works with either **Bun** (recommended) or **npm**.

```sh
# clone
git clone https://github.com/Jivaansh-Yadav/lambda-prep-test.git
cd lambda-prep-test

# --- with Bun ---
bun install
bun run dev          # http://localhost:3000

# --- with npm ---
npm install
npm run dev          # http://localhost:3000
```

Other scripts (same for both package managers — swap `bun run` ↔ `npm run`):

| Script | Purpose |
|---|---|
| `dev` | Start the Vite dev server on port 3000 |
| `build` | Production build |
| `build:dev` | Development-mode build |
| `preview` | Preview a production build locally |
| `lint` | Run ESLint |
| `format` | Run Prettier (writes changes) |
| `test` | Run the Vitest suite once |
| `test:watch` | Run Vitest in watch mode |

### Environment variables

Create a `.env` file (never commit it) with:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string — ratings, admin/integration data, analytics cache |
| `ADMIN_PASSCODE` | Passcode gating access to `/admin` |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` | Used by `scripts/analytics-cron` to pull Cloudflare Web Analytics |
| `GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_REFRESH_TOKEN` | OAuth credentials for a real Google account with Editor access to the resources folder — used for admin Drive **writes** (upload/rename/delete in "Manage resources"); falls back to the Neon-stored service account (read-only safe) when unset |
| `ISC11_SRC_DIR` | Optional override for the ISC Class 11 raw upload source directory used by the resource pipeline |
| `NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_DESCRIPTION` | Public app branding metadata |

Eazo-managed deployment/platform variables are synced automatically and should not be set manually.

### Regenerating the resource catalog

The datasets under `src/data/` are generated, not hand-authored. After new files land in the source Google Drive:

```sh
node scripts/generate-all-resources.js
```

This runs the full pipeline: Drive crawl → Python transform (CISCE + community, including the ISC-11 variant) → split oversized groups → re-sort manifests → recompute `resource-counts.json`. Requires valid Google Drive service-account credentials configured for `scripts/drive-crawl`.

## Corporate details

- **Legal entity**: Lambda Education Pvt. Ltd.
- **Product**: Lambda Prep — the public web portal.
- **Repository**: `Jivaansh-Yadav/lambda-prep-test` (private).
- **Copyright**: © 2026 Lambda Education Pvt. Ltd. All rights reserved.
- **License**: Proprietary. This source code and all associated content are not licensed for reuse, redistribution, or derivative works without explicit written permission from Lambda Education Pvt. Ltd.
