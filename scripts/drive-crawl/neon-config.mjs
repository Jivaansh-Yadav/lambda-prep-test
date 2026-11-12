// Shared access to the credentials the weekly pipeline needs, read from Neon.
//
// Nothing here is a repository secret of its own: the Drive service-account key
// and the InstaRevision upload credential both live in Neon, which is where the
// running app reads the Drive key from too. Keeping one copy means a rotated
// credential cannot leave the weekly job authenticating with a stale one.
//
// Queries go over Neon's HTTP /sql endpoint with a raw fetch, so this module has
// zero npm dependencies — it can run before `npm install` and cannot drift with
// a pg client version.
//
// Credentials in, in order:
//   1. DATABASE_URL (or NEON_DATABASE_URL) -> Neon.
//   2. An inline env var, for a runner with no database access.
//
// Nothing here prints secret material.

const DRIVE_QUERY =
  "SELECT service_account_json::text AS key FROM drive_integration WHERE id = true LIMIT 1";
const INSTA_QUERY =
  "SELECT username, password FROM insta_revision_integration WHERE id = true LIMIT 1";

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

/** POST one parameterised statement to Neon's HTTP endpoint and return the JSON payload. */
export async function neonQuery(query, params = []) {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. It is the only credential this step needs — the " +
        "Drive key and the InstaRevision auth are both read from Neon with it.",
    );
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid postgres:// connection string.");
  }
  if (!url.hostname) throw new Error("DATABASE_URL has no host.");

  const endpoint = `${url.protocol === "http:" ? "http" : "https"}://${url.host}/sql`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Neon-Connection-String": connectionString,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, params }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`Could not reach Neon at ${url.host}: ${err.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Neon /sql returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Neon /sql returned non-JSON: ${text.slice(0, 300)}`);
  }
  if (payload.message) throw new Error(`Neon query failed: ${payload.message}`);
  return payload;
}

/** The Drive service-account key object from `drive_integration`. */
export async function getDriveServiceAccount() {
  const payload = await neonQuery(DRIVE_QUERY);
  const row = payload.rows?.[0];
  if (!row) {
    throw new Error(
      "drive_integration has no row. Seed it with the service-account JSON and " +
        "folder_id — the admin panel's Drive integration card does this.",
    );
  }
  const raw = row.key ?? row.service_account_json;
  if (!raw) throw new Error("drive_integration.service_account_json is empty.");

  // jsonb arrives as an object or a JSON string depending on the cast; accept both.
  let key;
  try {
    key = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("drive_integration.service_account_json is not valid JSON.");
  }
  if (!key || typeof key !== "object") {
    throw new Error("drive_integration.service_account_json did not yield a key object.");
  }
  const missing = ["client_email", "private_key"].filter((field) => !key[field]);
  if (missing.length) {
    throw new Error(
      `drive_integration.service_account_json is missing ${missing.join(
        ", ",
      )}. Expected the service-account key JSON.`,
    );
  }
  return key;
}

/**
 * The InstaRevision upload credential as a ready-to-send Authorization header.
 *
 * `em_content_private` is not public-readable: `upload.extramarks.com/getSignedUrl`
 * holds the bucket's signing key and accepts this credential to mint links on
 * its behalf. It used to be a literal in generate-insta-revision-links.mjs, which
 * is a public repo — so it is now read from Neon instead.
 */
export async function getInstaRevisionAuth() {
  const payload = await neonQuery(INSTA_QUERY);
  const row = payload.rows?.[0];
  if (!row) {
    throw new Error(
      "insta_revision_integration has no row. Seed it with the InstaRevision " +
        "upload username and password.",
    );
  }
  const { username, password } = row;
  if (!username || !password) {
    throw new Error("insta_revision_integration row is missing username or password.");
  }
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

/** Env override first, then Neon — so a local run can pass INSTA_REVISION_AUTH. */
export async function resolveInstaRevisionAuth() {
  const inline = (process.env.INSTA_REVISION_AUTH || "").trim();
  if (inline) {
    return /^Basic /i.test(inline) ? inline : `Basic ${inline}`;
  }
  return getInstaRevisionAuth();
}
