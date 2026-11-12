# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | TanStack Start + React 19 | SSR, server functions and route-level data loading without a second API tier |
| Bundler | Vite 8 | Client + SSR builds, `@lovable.dev/vite-tanstack-config` supplies the plugin stack |
| Styling | Tailwind CSS 4 (CSS-first config) | No `tailwind.config.js`; tokens live in `src/styles.css` |
| Server runtime | Nitro (`cloudflare-module` / `cloudflare-pages`) | One build, two deploy shapes (see [Deployment](Deployment)) |
| Database | Neon Postgres over `@neondatabase/serverless` | HTTP driver, works from an edge worker, no pool to babysit |
| Tests | Vitest | Unit tests beside the code |
| Pipeline | Node + Python | Node crawls, Python transforms, Node orchestrates |

## The request path

```
browser → Cloudflare edge (_headers, _redirects, static assets)
        → _worker.js (Nitro)
        → src/server.ts  fetch()
             1. short-link check  (/drive, /github → 302)
             2. TanStack Start server entry (SSR + server functions)
             3. normalizeCatastrophicSsrResponse()
             4. withSecurityHeaders()
```

### `src/server.ts`

This file is the SSR entry (`tanstackStart.server.entry = "server"` in `vite.config.ts`, so Nitro builds from it rather than from the framework default). It does four things:

1. **Short links.** `resolveShortRedirect(new URL(request.url))` runs before SSR so `/drive` and `/github` return a `302` with `cache-control: public, max-age=300`, even on hosts that never read `public/_redirects`. Destinations live in `src/lib/redirects.ts`.
2. **Lazy server entry.** `getServerEntry()` imports `@tanstack/react-start/server-entry` once and memoises the module promise — the worker stays small and a cold start does not re-import on every request.
3. **Catastrophic SSR normalisation.** h3 swallows in-handler throws into a `500` whose body is `{"unhandled":true,"message":"HTTPError"}`; a normal `try/catch` never fires. `normalizeCatastrophicSsrResponse()` detects that exact body shape, logs the error captured by `src/lib/error-capture.ts`, and replaces the JSON with the HTML error page from `src/lib/error-page.ts`. Without this, a crashed SSR render shows a blank screen instead of something readable.
4. **Security headers.** `withSecurityHeaders()` sets CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` and `Cross-Origin-Opener-Policy: same-origin` unless the route already set them.

### Security headers, and the two deliberate omissions

- **No `X-Frame-Options`.** The app is embedded in Eazo previews and in its own share links. `frame-ancestors` in the CSP is the modern control and is explicitly allowlisted (`'self'`, `https://*.e2b.app`, `https://*.eazo.dev`, `https://*.eazo.ai`). Per the spec, an enforced `frame-ancestors` makes browsers ignore `X-Frame-Options`, but a per-response `SAMEORIGIN` on a route that skipped CSP would silently re-block the preview iframe — so the header is omitted and the allowlist lives in one place.
- **`fullscreen=(self …)` is not empty.** The resource viewer requests fullscreen on its own document, and the Extramarks player and the Drive PDF viewer each carry their own fullscreen button *inside* a frame. An `<iframe allow="fullscreen">` can only narrow the header policy, never widen it, so those two origins are listed explicitly. Leaving `fullscreen=()` makes those buttons dead controls.

`public/_headers` repeats the same policy for hosts that serve static files without the worker. **Keep the CSP in the file byte-identical to `CONTENT_SECURITY_POLICY` in `src/server.ts`.** Cloudflare Pages also appends a Nitro fallback rule to `_headers` at build time for unmatched routes.

The CSP itself is scoped to what the app really uses:

- `frame-src` — `drive.google.com` (embedded PDFs), `mscontent-gcp.extramarks.com` (interactive classes), `storage.googleapis.com` (signed InstaRevision PDFs).
- `connect-src` — Extramarks, `cloudflareinsights.com` (Web Analytics beacon).
- `script-src` — `static.cloudflareinsights.com`; `img-src` — `drive.google.com` thumbnails.

## Routing

File-based, one file per route, `src/routes/__root.tsx` is the only root layout.

| File | URL | Notes |
| --- | --- | --- |
| `index.tsx` | `/` | Landing: class cards, Editor's Choice, counts |
| `classes.$classId.tsx` | `/classes/:classId` | Slug is `icse-9`, `icse-10`, `isc-11`, `isc-12` |
| `resources.tsx` + `resources.index/cisce/community.tsx` | `/resources[/cisce|/community]` | Shared browsing component, source-scoped |
| `doxxmarks.tsx` | `/doxxmarks` | Curriculum browser + player |
| `contribute.tsx` | `/contribute` | Submission form |
| `admin.tsx` | `/admin` | Passcode gate, dashboard, section pages via `?section=` |
| `sitemap[.]xml.ts` | `/sitemap.xml` | Real handler, generated per request |

Query-parameter conventions matter because share links depend on them:

- `/doxxmarks?class=icse-10&subject=Biology&chapter=0&note=0` — `class` is a slug, `subject` is a display name, `chapter` and `note` are **indices** into the subject's chapter list and that chapter's note list.
- `/resources?board=icse&class=10&subject=…` — filters are additive and every one of them is reflected in the URL so a filtered view is shareable.

`src/routes/routeTree.gen.ts` is generated — never edit it by hand.

## Data loading

Datasets are static JSON under `src/data/`, imported through `src/lib/resources-data.ts`, which exposes:

- `manifest.json` per class — subjects, their shard file (if any), Featured ordering and counts.
- `resources-{cisce,community}-<class>.json` — the whole catalogue for a class, **or** a directory of per-subject shards once it crosses the size threshold (see [Resource-Pipeline](Resource-Pipeline)).
- `resource-counts.json` — per class, per source, per subject totals written by `scripts/count-resources.py`; a build/reporting artifact. The class page's own total is summed from the manifest counts, so the two agree only if both count files inside `editorFolders` (see [Resource-Pipeline](Resource-Pipeline)).
- `doxxmarks_resources.json` — the Doxxmarks curriculum (see [Doxxmarks-and-Signed-Links](Doxxmarks-and-Signed-Links)).

Because the datasets ship as ES modules they are code-split with the route that needs them: opening ISC 12 never downloads ICSE 9's catalogue. Inside a catalogue, virtualisation (`@tanstack/react-virtual`) keeps a 400-file group cheap to scroll, and Fuse.js indexes only the active catalogue.

Server functions (`createServerFn` in `src/lib/*-server.ts`) handle everything that must not trust the client: ratings, views, downloads, shares, contributions, feedback, contact, admin, Drive, GitHub and Cloudflare calls.

## Rendering and theming

- **Theme with no flash** — `__root.tsx` runs a small inline script that sets the theme class on `<html>` before first paint, so a dark-mode visitor never sees a white flash.
- **i18n** — `src/lib/i18n.tsx` holds every user-facing string under `en-US` and `zh-CN`. Components call `t('key')`; no literal copy in JSX. Adding a language means adding one dictionary, not touching components.
- **Client error capture** — `src/lib/error-capture.ts` records the last error, and the client reporter posts unhandled errors to a server route with the route path and a hashed visitor id, so a broken page is reportable without a third-party SDK.
- **404/500** — a dedicated not-found component in `__root.tsx` (with its own title, so a 404 never inherits the landing page's SEO tags) and the HTML error page used by the SSR wrapper.

## Directory map

```
src/
├── routes/           # one file per URL (see the table above)
├── components/
│   ├── lambda-prep/  # shell, resource/note/doxx players, rating, sharing, grids
│   └── ui/           # shadcn-style primitives
├── lib/
│   ├── lambda-prep.ts  # SITE_URL, RUM_SITE_TAG, pageHead(), class/subject metadata helpers
│   ├── brand.ts      # logo + hero asset paths
│   ├── redirects.ts  # /drive and /github destinations
│   ├── db.ts         # Neon client singleton
│   ├── i18n.tsx      # dictionaries + t()
│   ├── resources-data.ts / curriculum.ts / resource-lookup-server.ts
│   ├── workflow-progress.ts  # GitHub step → category mapping
│   └── *-server.ts   # server functions: admin, drive, github, cloudflare,
│                     # ratings, views, shares, feedback, contact, contribute
├── data/             # committed datasets (pipeline output)
├── styles.css        # design tokens + component CSS
└── server.ts         # SSR entry (short links, error normalisation, headers)
```
