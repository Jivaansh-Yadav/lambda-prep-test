// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Two deploy shapes, one codebase:
//   - default      -> `cloudflare-module` (Workers + static assets, .output/server/index.mjs)
//   - pages target -> `cloudflare-pages`  (Pages project, .output/public + _worker.js)
// The Pages build is opt-in via `bun run build:pages` (LAMBDA_PREP_BUILD_TARGET=pages) so the
// canonical https://lambda-prep.pages.dev deployment is reproducible from this repository.
const pagesTarget = process.env["LAMBDA_PREP_BUILD_TARGET"] === "pages";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...(pagesTarget ? { nitro: { preset: "cloudflare-pages" as const } } : {}),
  vite: {
    server: {
      allowedHosts: true,
    },
  },
});
