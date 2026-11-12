# Deployment

Canonical production: **https://lambda-prep.pages.dev**, a Cloudflare Pages project built from `main` of this repository.

## Two build shapes

The codebase produces two different Nitro outputs; pick the one that matches the host.

| Command | Nitro preset | Output | Host |
| --- | --- | --- | --- |
| `bun run build` | `cloudflare-module` | `.output/public` + `.output/server/index.mjs` | Workers with static assets, or any preview host |
| `bun run build:pages` | `cloudflare-pages` | `dist/` (`_worker.js/`, static assets, `_routes.json`, `_headers`, `_redirects`) | Cloudflare **Pages** project |

`build:pages` simply sets `LAMBDA_PREP_BUILD_TARGET=pages`, which `vite.config.ts` reads to pass `nitro: { preset: "cloudflare-pages" }` to the config wrapper. Everything else — plugins, aliases, SSR entry — is identical, so there is exactly one application, not two.

The Pages build also emits `dist/_worker.js/wrangler.json`:

```json
{
  "compatibility_date": "…",
  "pages_build_output_dir": "..",
  "name": "jivaansh-yadav-lambda-prep",
  "compatibility_flags": ["nodejs_compat"]
}
```

`name` is auto-generated from the git remote (`owner-repo`), so it never matches the Pages project name — always pass `--project-name lambda-prep` when deploying by hand. The Git integration ignores this file and uses the dashboard project.

## Cloudflare Pages project settings

| Setting | Value |
| --- | --- |
| Project name | `lambda-prep` — the hostname follows it, and `lambda.pages.dev` is already taken |
| Production branch | `main` |
| Build command | `npm install && npm run build:pages` |
| Output directory | `dist` |
| Root directory | *(repository root)* |
| Node version | pinned in the repo by `.nvmrc` (`22`) — this is what the build image reads |
| Build environment variable | `LAMBDA_PREP_BUILD_TARGET = pages` is *not needed* — the script sets it. Set it anyway if you switch the build command to a bare `vite build`. |
| Compatibility flag | `nodejs_compat` (required: SSR + Neon driver) |
| Environment variable (secret) | `DATABASE_URL` — Neon connection string, encrypted |

Notes that have bitten before:

- **Node ≥ 22.12.** Vite 8 declares `^20.19.0 || >=22.12.0`; `.nvmrc` pins `22` so the build never depends on whatever the image happens to default to.
- **`nodejs_compat` is not optional.** Without it the worker fails at import time with a node-builtin error and Pages shows a 500 on every route with no useful log line.
- **Output directory is `dist`, not `.output`.** The Pages preset writes to `dist`; pointing the project at `.output` produces a “no `_worker.js`” error.
- **`public/_headers` and `public/_redirects` are copied into `dist` by Nitro**, then Pages applies them at the edge. Nitro also appends a fallback rule to `_headers` for unmatched routes.
- **Do not add Netlify's `!` force syntax to `_redirects`.** Cloudflare Pages does not understand a trailing `!`; it ends up parsed as part of the path or as a malformed status and the rule silently never matches. Plain `302` is correct here.
- **Bun is not available in the Pages build image.** Install with `npm`; `bun.lock` is for local development, and npm resolves the same versions from `package.json`.

## Environment variables

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Pages env (secret) | for counters/admin | Neon Postgres |
| `ADMIN_PASSCODE` | Pages env (secret) | for `/admin` | The gate's passcode — unset means every admin server function rejects every attempt |
| `DATABASE_URL` | GitHub Actions secret | for the weekly run | The only credential the workflow holds: both the Drive key and the InstaRevision upload credential are read from Neon with it |
| `SERVICE_ACCOUNT` | GitHub Actions secret | optional | Raw key JSON, only a fallback when the runner has no database access |
| `NODE_VERSION` | Pages env | no | overrides `.nvmrc` when you need a different Node for one build |

The dashboard wizard that creates a Git-connected project only accepts **plaintext** pairs; encrypted values are added afterwards in **Settings → Environment variables** (choose **Encrypt**), and the deployment has to be retried because variables are baked in at deploy time. The REST API does accept secrets at creation — `deployment_configs.production.env_vars: { DATABASE_URL: { type: "secret_text", value: "…" } }` — if the project is ever recreated from a script.

No other secret is read from `process.env`. Drive, GitHub and Cloudflare credentials (including the Cloudflare RUM API token) are rows in the database, seeded by hand in the Neon SQL editor and only ever read by `/admin` — deliberate: rotating them is a SQL update, not a redeploy.

**Never** put a credential in a `VITE_*` variable. Those are compiled into the client bundle.

## Deploy

Push to `main`. Pages builds and deploys automatically; the deployment is live in roughly a minute, and `lambda-prep.pages.dev` is aliased to the newest successful build.

Manual deploy, if the git integration is unavailable:

```bash
bun run build:pages
npx wrangler pages deploy dist --project-name lambda-prep
```

`wrangler` needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment; never commit them.

## Rollback

1. Cloudflare dashboard → Pages → `lambda-prep` → **Deployments**.
2. Pick the last known-good deployment, **Rollback to this deployment**. Alias flips immediately; no rebuild.
3. Fix forward on `main` afterwards — a rollback is a stopgap, not a state to live in.

Because datasets are committed by the pipeline, a bad dataset ships as a normal commit. To undo one: `git revert <chore commit>` and push; Pages rebuilds with the previous JSON. There is no need to re-run the crawl.

## Custom domain

If a custom domain replaces `lambda-prep.pages.dev`:

1. Pages → Custom domains → add the domain, follow the DNS instructions.
2. Change `SITE_URL` in `src/lib/lambda-prep.ts`.
3. `https://lambda-prep.pages.dev` in `public/robots.txt` (the `Sitemap:` line).
4. Web Analytics: **Manage site** → edit that site's hostname to the new domain (the beacon token does not change). A brand-new site instead means changing `RUM_SITE_TAG` in `src/lib/lambda-prep.ts` too — it is the value both the beacon and the admin queries read.
5. Redeploy, then confirm `canonical`, `og:url` and every `<loc>` in `/sitemap.xml` use the new origin, and that `/admin` → Deep analytics still returns numbers.

Keeping the origin in one exported constant is what makes this a three-line change; do not scatter literals back in.

## The old host

`https://project-3354c0eb.eazo.dev` (Vercel, project `prj_MuurzSuGrQ9otvBWWoBwaFxmjSXF`) was the previous production. Once `lambda-prep.pages.dev` is the canonical origin it should be retired or redirected; leaving two live origins with one canonical tag is how duplicate content and stale links accumulate.

To deploy this codebase to a non-Cloudflare host, override the preset instead of forking the config:

```ts
nitro: { preset: "vercel" } // or "node-server", "netlify", …
```

## Verifying a deploy

```bash
curl -sI https://lambda-prep.pages.dev/            | head -3   # 200, content-security-policy present
curl -s  https://lambda-prep.pages.dev/ | grep -o '<link rel="canonical"[^>]*>'
curl -sI https://lambda-prep.pages.dev/drive       | grep -i location,http
curl -sI https://lambda-prep.pages.dev/github      | grep -i location,http
curl -s  https://lambda-prep.pages.dev/sitemap.xml | head -5
```

Then open `/doxxmarks?class=icse-10&subject=Biology&chapter=0&note=0` and confirm the revision-note PDF loads from `storage.googleapis.com` — that single check exercises the dataset, the signed links and the CSP `frame-src` rule at once.
