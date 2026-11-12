# SEO and short links

## One canonical origin

`src/lib/lambda-prep.ts`:

```ts
export const SITE_URL = 'https://lambda-prep.pages.dev';
export const OG_IMAGE = `${SITE_URL}/og/lambda-prep-og.png`;
```

Everything SEO-shaped derives from those two values:

| Surface | Source |
| --- | --- |
| `<link rel="canonical">`, `og:url` | `pageHead()` / `__root.tsx`, both from `SITE_URL` |
| `<title>` | `pageHead()` → `` `Lambda Prep | ${title}` `` (brand first) |
| `og:image`, `twitter:image` | `OG_IMAGE` |
| `/sitemap.xml` `<loc>` entries | `SITE_URL` + route path |
| `robots.txt` `Sitemap:` line | static, must be kept in sync by hand |
| JSON-LD `WebSite.url` | `SITE_URL` |

A literal origin anywhere else is a bug: it survives a domain change and produces canonical tags pointing at a host you no longer control. When the origin changes, the list above is the whole checklist.

**Why a constant and not the request host?** SSR metadata is generated before any browser origin exists (and behind a proxy the request host can be anything). A single declared canonical origin is what search engines should index. Share links are different — they use `getSiteOrigin()`, which prefers `window.location.origin` so a share always points wherever the reader actually is.

## Per-page metadata

`pageHead(title, description, path)` returns the `meta` and `links` arrays TanStack Start wants:

- `title` gets the brand as a **prefix**: `Lambda Prep | <page title>`.
- `canonical` is `SITE_URL + path`.
- `og:*` / `twitter:*` are set, including the image, so a shared link renders a card.
- Descriptive text is per-route and human-written; there is no generated keyword soup.

Special cases:

- **404** sets its own title (`Lambda Prep | Page not found`). A 404 that inherits the landing page's tags is an SEO liability.
- **`/admin`** is `noindex, nofollow` and is not in the sitemap.
- **Landing page** passes only `Your school resource hub`, which renders as `Lambda Prep | Your school resource hub` — the page string never repeats the brand, because `pageHead()` already puts it first.

## Sitemap

`src/routes/sitemap[.]xml.ts` is a real route, not a static file, but its contents are a **hand-maintained table** (`SITEMAP_ENTRIES`) rather than something derived from the datasets:

- the four class pages,
- `/resources`, `/resources/cisce`, `/resources/community`,
- `/doxxmarks`,
- `/contribute`,
- plus the landing page.

Each entry carries `path`, `priority` and `lastmod`; the `<loc>` is built at request time from `SITE_URL`. Adding a route means adding a row here — nothing generates it for you.

Two rules for that table:

1. **Only include routes that exist for everyone.** A per-subject URL that 404s for a class without that subject is worse than not listing it.
2. **Never hardcode the origin.** `buildSitemapXml()` builds every `<loc>` as `${SITE_URL}${path}`.

`public/sitemap.xsl` styles the XML when a human opens it, so the sitemap is readable in a browser instead of a wall of markup.

`public/robots.txt` allows the major crawlers explicitly, allows everything else, and ends with the absolute `Sitemap:` URL. It is a static file — if `SITE_URL` changes, this line changes with it.

## OG image

`public/og/lambda-prep-og.png` (1200×630) is served from `public/`, so it is not content-hashed; `_headers` gives it `max-age=604800, must-revalidate` so a replacement is picked up without waiting for an immutable cache to expire.

## Short links

Two links, one purpose: send a student or a contributor somewhere useful without making them read a URL.

| Path | Destination | Why 302 |
| --- | --- | --- |
| `/drive` | `https://drive.google.com/drive/folders/1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc` | The root Drive folder can be reorganised or re-shared; a permanent redirect would pin a dead id |
| `/github` | `https://github.com/Jivaansh-Yadav/lambda-prep` | The repository can be renamed or transferred |

Both are `302` on purpose, and both are **implemented twice**:

1. **`public/_redirects`** — the edge. Cloudflare Pages and Netlify read it before serving anything, so the redirect costs no worker invocation.
2. **`src/server.ts`** — the SSR entry. Hosts that hand every request to the worker (Workers, some Node hosts, the preview sandbox) never consult `_redirects`; the server-level check makes the links work there too.

The destinations live in `src/lib/redirects.ts`, imported by the server; `_redirects` duplicates them because it is static. Both carry the same trailing-slash behaviour (`/drive/` → same destination) and the worker response sets `cache-control: public, max-age=300`.

Implementation notes:

- **No `!` force syntax.** That is Netlify-specific; Cloudflare Pages parses it as garbage and the rule silently stops matching.
- **Absolute destinations.** These are third-party surfaces, not routes, so a relative target would loop back into the app.
- **No `301`.** A permanent redirect is cached by browsers for months; changing a folder id then becomes unfixable for returning visitors.
- **Status column is explicit** (`302`), not left to the host default, because Netlify and Pages have different defaults for asset-shaped paths.

## Adding a short link

1. Add the destination to `SHORT_REDIRECTS` in `src/lib/redirects.ts`.
2. Add the matching rule to `public/_redirects`.
3. Verify both paths: one request through the dev server (worker path) and one through a Pages preview (edge path).

## A note on `noindex` and previews

Preview deployments of the same app are reachable at `*.pages.dev` preview hosts. They are not linked from the production sitemap, and `robots.txt` allows crawling — if preview URLs ever get indexed, add a `robots.txt` variant or a `X-Robots-Tag` header scoped to preview environments rather than blanking the production one.
