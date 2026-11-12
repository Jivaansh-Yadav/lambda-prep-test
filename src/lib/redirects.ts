// Canonical outbound destinations. Kept in one module so the edge redirects in
// public/_redirects and the Worker-level redirects in src/server.ts cannot
// drift apart.
export const DRIVE_ROOT_ID = "1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc";
export const DRIVE_ROOT_URL = `https://drive.google.com/drive/folders/${DRIVE_ROOT_ID}`;
export const REPO_URL = "https://github.com/Jivaansh-Yadav/lambda-prep";

/**
 * Short links served by this app. `destination` is absolute on purpose: both
 * are third-party surfaces, not routes of this site.
 */
export const SHORT_REDIRECTS: Record<string, string> = {
  "/drive": DRIVE_ROOT_URL,
  "/github": REPO_URL,
};

/**
 * Returns the absolute destination for a short link, or null when the path is
 * not one. Trailing slashes are normalised so `/drive/` behaves like `/drive`.
 */
export function resolveShortRedirect(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return SHORT_REDIRECTS[path] ?? null;
}
