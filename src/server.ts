import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Security response headers. Applied in the server entry (rather than only
// in `public/_headers`, which is a Cloudflare Pages convention the current
// host ignores) so they ride along with every document this app serves.
//
// The CSP is scoped to what the app actually loads:
//   - drive.google.com        -> resource PDF previews (resource-watch)
//   - mscontent-gcp.extramarks.com -> Doxxmarks interactive lessons (iframe)
//                              and lesson videos (HLS: manifest + segments via
//                              hls.js, which fetches them with XHR)
//   - cdn.eazo.ai / eazo.ai / assets.eazo.ai -> Eazo branding banner script,
//                              its API calls and its logo
//   - fonts.googleapis.com / fonts.gstatic.com -> DM Sans + Manrope
// 'unsafe-inline' is required for scripts (the theme-before-first-paint
// bootstrap, JSON-LD and TanStack Start's hydration payload are inline) and
// for styles (React inline style attributes). It is a known compromise, not
// an oversight — the remaining directives (frame-ancestors, object-src,
// base-uri, connect-src/frame-src allowlists) are what actually contain an
// XSS or clickjacking attempt here.
//
// frame-ancestors also allows https://*.e2b.app and https://*.eazo.dev/.ai —
// those are the Eazo sandbox preview host and production alias domains that
// embed this app in their own iframe (Creator's live Preview panel and
// in-app QR/test links). Without them the host shows its own clickjacking
// block page instead of the app.
// ---------------------------------------------------------------------
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cdn.eazo.ai",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cdn.eazo.ai https://assets.eazo.ai https://drive.google.com",
  "media-src 'self' blob: https://mscontent-gcp.extramarks.com",
  "connect-src 'self' https://mscontent-gcp.extramarks.com https://eazo.ai https://cdn.eazo.ai",
  "frame-src 'self' https://drive.google.com https://docs.google.com https://mscontent-gcp.extramarks.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'self' https://*.e2b.app https://*.eazo.dev https://*.eazo.ai",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
  // No X-Frame-Options header here: per the HTML/CSP spec, an enforced CSP
  // frame-ancestors directive makes browsers ignore X-Frame-Options, but it
  // is per-response — if a route sets X-Frame-Options itself and skips CSP,
  // SAMEORIGIN would silently re-block the Eazo preview iframe. Omitting it
  // keeps the allowlist in one place (frame-ancestors above); every current
  // browser enforces that directive, and the app registers nothing that
  // needs the IE/old-Safari-only fallback.
  ["X-Content-Type-Options", "nosniff"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  // `fullscreen=(self)` is deliberate: the resource viewer requests fullscreen
  // on its own document, and leaving `fullscreen=()` in place would block that.
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
];

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  // Never clobber a header a route set deliberately.
  for (const [name, value] of SECURITY_HEADERS) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
