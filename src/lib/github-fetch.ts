// github-fetch.ts
//
// Header construction and the one read-only fetch helper shared by the
// admin GitHub client. Kept out of github-integration-server.ts so the
// credential-fallback rule can be unit tested without a database.

export const GITHUB_API = "https://api.github.com";

export function anonHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub's REST API rejects requests without a User-Agent header
    // (HTTP 403 "Request forbidden by administrative rules").
    "User-Agent": "lambda-prep-admin",
  };
}

export function authHeaders(pat: string) {
  return { Authorization: `Bearer ${pat}`, ...anonHeaders() };
}

/**
 * Whether a rejected request is worth retrying anonymously. A revoked PAT
 * answers 401; a PAT that still works but lacks the scope for this endpoint
 * answers 403. A rate-limited caller also gets 403, and retrying that would
 * be pointless — the anonymous limit is lower still — so `remaining: 0`
 * disqualifies the retry.
 */
function shouldRetryAnonymous(res: Response) {
  if (res.status === 401) return true;
  if (res.status !== 403) return false;
  return res.headers.get("x-ratelimit-remaining") !== "0";
}

/**
 * Read-only GitHub GET that survives a stale credential. Every repo this
 * app points at is public, so a revoked PAT should cost us the higher
 * authenticated rate limit — never the card. When GitHub rejects the
 * credential we retry once anonymously: if that also fails, the caller
 * reports the anonymous status, which is the one that describes reality.
 *
 * Writes (the workflow dispatch) deliberately do NOT use this: a dispatch
 * that silently degraded to anonymous would just be a confusing 404.
 */
export async function githubGet(url: string, pat: string): Promise<Response> {
  const authed = await fetch(url, { headers: authHeaders(pat) });
  if (!shouldRetryAnonymous(authed)) return authed;
  return fetch(url, { headers: anonHeaders() });
}
