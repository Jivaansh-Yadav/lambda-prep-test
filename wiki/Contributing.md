# Contributing

## Local setup

```bash
git clone https://github.com/Jivaansh-Yadav/lambda-prep.git
cd lambda-prep
bun install
bun run dev        # http://localhost:3000
bun run test       # vitest, 18 tests / 3 files
bunx tsc --noEmit  # type check (the real gate)
```

Optional: `DATABASE_URL` (Neon) in `.env` enables counters, ratings and `/admin`. Python 3.11 + Node 20 are needed only for the pipeline scripts.

Pipeline, if you have Drive credentials at `scripts/drive-crawl/service-account.json`:

```bash
node scripts/generate-all-resources.js --skip-crawl   # rebuild datasets from last crawl
```

## Conventions this codebase actually follows

### Routes
- One file per URL in `src/routes/`. `routeTree.gen.ts` is generated — never edit it.
- Every route defines `head` via `pageHead(title, description, path)` from `src/lib/lambda-prep.ts`, so canonical/OG metadata cannot be forgotten.
- Dynamic segments use `$` (`classes.$classId.tsx`), splats use `$` (`$.tsx` → `_splat`). Never `:id` or `*`.
- Shareable state goes in the URL (see `/doxxmarks` and `/resources`), not in component state.

### Copy and i18n
- Every user-facing string lives in `src/lib/i18n.tsx` under both `en-US` and `zh-CN`. A literal string in JSX is a bug.
- Keys are grouped by surface (`faq.*`, `share.*`, `doxx.*`). Adding a key means adding it to both dictionaries.

### Data
- `src/data/*` is generated. If you need different content, change the pipeline, not the JSON.
- Only `doxxmarks_resources.json`'s chapter skeleton and `insta-revision-sources.json` are hand-structured.
- Counts come from `resource-counts.json`; never compute a total on the client.

### Server functions
- Anything touching the database or a third party is a `createServerFn` in `src/lib/*-server.ts`.
- Admin endpoints call `requirePasscode()` first, every time.
- Public write endpoints get a rate limit and an existence check on the resource id (`ratings-server.ts` is the reference implementation).
- Handle `sql === null` by returning `{ ok: false, reason: 'not configured' }`, never by throwing.

### Styling
- Tailwind utilities inline; anything repeated or stateful goes in `src/styles.css` as a named class.
- Design tokens (colour, spacing, radii) are CSS variables at the top of `src/styles.css`. Do not invent new hex values in components.
- Responsive breakpoints: one column below `sm`, two at `sm`, four at `lg`. Test at 390 px before claiming a layout is done.
- Dark mode is class-based on `<html>`, set before paint by the bootstrap script in `__root.tsx`.

### Security
- New header? Add it to **both** `CONTENT_SECURITY_POLICY` in `src/server.ts` and `public/_headers`.
- New third-party embed? It needs a `frame-src` (and often `Permissions-Policy`) entry, or it works in dev and breaks in production.
- Never put a credential behind a `VITE_` prefix; those are compiled into the client bundle.

## Tests

```bash
bun run test          # run once
bun run test:watch
```

Current suites:

| File | Covers |
| --- | --- |
| `src/lib/workflow-progress.test.ts` | Step → category mapping, roll-ups, duration maths |
| `src/test/lambda-prep.test.ts` | Class/subject metadata helpers, stream matching |
| `src/test/app-routing.test.tsx` | Route wiring smoke test |

Expectations:
- Pure functions (categorisation, metadata lookup, URL parsing) must have tests — they are where silent regressions live.
- Server functions with a database are tested manually against a Neon branch; do not assert on a live database in CI.
- A bug fix ships with a test that fails before it.

## Formatting debt

`bun run lint` currently reports a large number of `prettier/prettier` errors in files that were written in a compact style (single-line JSX sections, long call sites). They are **pre-existing and known**; a full `--fix` would produce a diff larger than the entire feature history and bury real changes.

Rule: format the files you touch. Do not run a repo-wide `--fix` in a feature PR.

## Pull requests

- One concern per PR. A dataset regeneration commit (`chore: regenerate resource datasets`) is never mixed with code.
- Describe the user-visible change first, implementation second.
- Include the verification you ran: `tsc`, `test`, and which URL you loaded in a browser. For anything touching embeds or CSP, state which iframe you actually opened.

## Where to look first

| You want to change… | Start at |
| --- | --- |
| Landing page | `src/routes/index.tsx` + `src/styles.css` |
| Class/resources browsing | `src/routes/resources*.tsx`, `src/components/lambda-prep/virtual-file-grid.tsx` |
| Doxxmarks player or notes | `src/components/lambda-prep/{doxx-watch,note-pdf-watch}.tsx` |
| Admin dashboard | `src/routes/admin.tsx` (sections are components in the same file) |
| Counters/ratings | `src/lib/{views,ratings,shares}-server.ts` |
| Pipeline | `scripts/` + `.github/workflows/update-resources.yml` |
| Headers / redirects | `src/server.ts`, `public/_headers`, `public/_redirects` |
| Metadata | `src/lib/lambda-prep.ts` (`SITE_URL`, `pageHead`) |
