# Lambda Prep

Lambda Prep is a study resource portal for ICSE (Classes 9–10) and ISC (Classes 11–12) students, built by Lambda Education Pvt. Ltd. It aggregates curated and community-sourced study material — notes, sample papers, previous-year/prelim question papers, and solutions — organized by class, stream, and subject, with fast fuzzy search and an admin panel for managing the resource catalog.

## What it does

- **Class & subject browsing** — dedicated hubs for ICSE Class 9/10 and ISC Class 11/12 (with Science/Commerce/Humanities stream filters for 11/12), each showing subject tiles that drill into resource listings.
- **Resources**
  - **CISCE resources** — official curriculum-aligned material per subject.
  - **Community resources** — crowd-sourced files (sample papers, PYQ/prelim papers, solutions) grouped by source, with an "Editor's Choice" curated subset highlighted for top-rated content.
  - Large groups (dozens to hundreds of files) are shown in a capped, scrollable preview with a "View all" expansion that switches to a virtualized grid for smooth performance.
- **Search** — instant fuzzy search (Fuse.js) across resource file names and across Doxxmarks subjects/chapters.
- **Doxxmarks** — an embedded reference/notes viewer section with subject and chapter navigation.
- **Syllabus** — reference pages for board syllabus content.
- **Ratings** — students can rate individual resource files to help surface the most useful ones (feeds the Editor's Choice curation).
- **Admin panel** (passcode-protected) — manage the resource catalog, browse/attach Google Drive folders as resource sources, and view traffic/engagement analytics (via Cloudflare Analytics, cached for performance).
- **Resource dataset pipeline** — a set of scripts that crawl a Google Drive service account, transform the folder/file tree into structured JSON datasets per class/subject, split large datasets, and regenerate manifests and resource counts shown across the site.

## Tech stack

- **Framework**: [TanStack Start](https://tanstack.com/start) (React 19) with [TanStack Router](https://tanstack.com/router) for file-based routing, SSR, and server functions.
- **Build tool**: [Vite](https://vitejs.dev/) 8, with the TanStack Router Vite plugin.
- **Styling**: Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com/)-style component primitives on top of Radix UI, `tw-animate-css`.
- **Data/search**: static per-subject JSON resource datasets, [Fuse.js](https://fusejs.io/) for client-side fuzzy search, [`@tanstack/react-virtual`](https://tanstack.com/virtual) for virtualized long lists.
- **Database**: [Neon](https://neon.tech/) serverless Postgres (`@neondatabase/serverless`) — used for ratings, admin/integration data, and cached analytics.
- **Charts**: Recharts (admin analytics dashboards).
- **Video**: Video.js (`@videojs/react`, `@videojs/hlsjs-video`) for any embedded video content.
- **Forms/validation**: React Hook Form + Zod.
- **Testing**: Vitest + Testing Library + jsdom.
- **Linting/formatting**: ESLint (flat config, typescript-eslint) + Prettier.
- **Package manager / runtime**: [Bun](https://bun.sh/) (also compatible with npm/Node for local dev per the scripts below).
- **Deployment**: Vercel (production), with the resource datasets generated/synced via standalone Node scripts and optionally a GitHub Actions workflow.

## Project structure

```
src/
  routes/            # file-based routes: home, class hubs, resources, doxxmarks, syllabus, admin
  components/
    lambda/          # feature components (class picker, resource grids, search, admin UI, etc.)
    ui/              # shared UI primitives (shadcn/radix-based)
    videojs/         # video player wrapper
  data/              # generated resource datasets (CISCE + community, per class/subject) and manifests
  hooks/             # shared React hooks (e.g. fuzzy search)
  lib/               # shared utilities, brand/asset constants, server-side helpers
  test/              # test setup/utilities
scripts/
  drive-crawl/              # crawls the Google Drive service account into a raw folder/file JSON tree
  transform-resources.py    # transforms the raw Drive tree into per-subject resource datasets
  transform-isc11-resources.py
  split-resources-dataset.py  # splits oversized datasets (e.g. large community buckets)
  sort-manifest-subjects.py   # keeps manifest subject ordering consistent
  count-resources.py          # regenerates resource-counts.json shown across the UI
  generate-all-resources.js   # orchestrates the full crawl → transform → split → count pipeline
  analytics-cron/             # scheduled job that pulls Cloudflare Web Analytics and caches it in Neon
public/              # static assets served as-is (images, logo, etc.)
```

## Getting started

Requires [Bun](https://bun.sh/) (or Node.js 18+ with npm/pnpm as a fallback).

```sh
bun install
bun run dev       # starts the dev server on http://localhost:3000
```

Other useful scripts:

```sh
bun run build        # production build
bun run preview       # preview a production build locally
bun run lint          # run ESLint
bun run format        # run Prettier
bun run test          # run the test suite once (Vitest)
bun run test:watch    # run tests in watch mode
```

### Environment variables

The app and its backing scripts expect a `.env` file (never committed) with values such as:

- `DATABASE_URL` — Neon Postgres connection string (ratings, admin/integration data, analytics cache).
- `ADMIN_PASSCODE` — passcode gating access to `/admin`.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` — used by the analytics cron job to pull traffic data.
- `NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_DESCRIPTION` — public app branding metadata.
- Additional Eazo platform integration variables are managed by the hosting platform and should not be set manually.

### Regenerating resource datasets

The resource catalog under `src/data/` is generated, not hand-written. To refresh it after new files are added to the source Google Drive:

```sh
node scripts/generate-all-resources.js
```

This runs the full pipeline: crawl Drive → transform into per-subject JSON → split oversized groups → resort manifests → recompute `resource-counts.json`. Requires Drive service-account credentials configured for `scripts/drive-crawl`.

## Design language

Corporate, institutional, and editorial: clean white/slate backgrounds with deep navy and electric-blue accents, a Half-Life-style Greek lambda (λ) mark as the brand logo, and generous whitespace with no decorative clutter.

## License

Proprietary — © 2026 Lambda Education Pvt. Ltd. All rights reserved.
