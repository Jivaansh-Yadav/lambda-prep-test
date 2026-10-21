import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";
import {
  getDriveIntegrationConfig,
  isDriveId,
  listDriveFolderFiles,
  type DriveFileEntry,
} from "./drive-integration-server";
import {
  getGithubIntegrationConfig,
  dispatchWorkflow,
  getWorkflowRunStatus,
  type WorkflowRunStatus,
} from "./github-integration-server";

// No fallback default: an unset ADMIN_PASSCODE must disable admin access
// entirely rather than silently accepting a hardcoded, publicly-visible
// value. See GH issue #7.
const ADMIN_PASSCODE = process.env["ADMIN_PASSCODE"];
if (!ADMIN_PASSCODE) {
  console.warn(
    "[admin] ADMIN_PASSCODE is not set — the admin panel will reject every passcode until it's configured."
  );
}
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------
// Per-IP passcode rate limiting (GH issue #8). In-memory only: resets on
// deploy/restart, which is acceptable for an admin login throttle (it
// isn't a persistent security boundary, just a brake on scripted
// guessing from a single instance). After MAX_ATTEMPTS wrong guesses
// within WINDOW_MS, the IP is locked out for an exponentially increasing
// duration (capped at MAX_LOCKOUT_MS), which keeps resetting as long as
// the attacker keeps guessing.
// ---------------------------------------------------------------------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes to accumulate failures
const BASE_LOCKOUT_MS = 30 * 1000; // first lockout: 30s
const MAX_LOCKOUT_MS = 15 * 60 * 1000; // cap at 15 minutes

type AttemptRecord = { count: number; firstFailureAt: number; lockUntil: number; lockLevel: number };
const attemptsByIp = new Map<string, AttemptRecord>();

function getClientIp(): string {
  try {
    // Trusts X-Forwarded-For because this app only ever runs behind
    // Cloudflare/Vercel, both of which set it reliably.
    return getRequestIP({ xForwardedFor: true }) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isLockedOut(ip: string): { locked: boolean; retryAfterMs: number } {
  const rec = attemptsByIp.get(ip);
  if (!rec) return { locked: false, retryAfterMs: 0 };
  const remaining = rec.lockUntil - Date.now();
  return remaining > 0 ? { locked: true, retryAfterMs: remaining } : { locked: false, retryAfterMs: 0 };
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const rec = attemptsByIp.get(ip);
  if (!rec || now - rec.firstFailureAt > WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, firstFailureAt: now, lockUntil: 0, lockLevel: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockLevel += 1;
    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** (rec.lockLevel - 1), MAX_LOCKOUT_MS);
    rec.lockUntil = now + lockoutMs;
    rec.count = 0;
    rec.firstFailureAt = now;
  }
}

function recordSuccess(ip: string): void {
  attemptsByIp.delete(ip);
}

/**
 * Single choke point for every admin passcode check (login screen and
 * every other admin server function alike), so brute-forcing can't
 * bypass the rate limiter by hitting a different endpoint than the login
 * one. Fails closed (never grants access) when ADMIN_PASSCODE isn't
 * configured, instead of falling back to a known default.
 */
function verifyPasscode(passcode: string): { ok: boolean; lockedOutMs?: number } {
  const ip = getClientIp();
  const lock = isLockedOut(ip);
  if (lock.locked) {
    return { ok: false, lockedOutMs: lock.retryAfterMs };
  }
  if (!ADMIN_PASSCODE) {
    return { ok: false };
  }
  if (passcode === ADMIN_PASSCODE) {
    recordSuccess(ip);
    return { ok: true };
  }
  recordFailure(ip);
  return { ok: false };
}

function requirePasscode(passcode: string) {
  const { ok, lockedOutMs } = verifyPasscode(passcode);
  if (!ok) {
    if (lockedOutMs) {
      throw new Error(`Too many attempts. Try again in ${Math.ceil(lockedOutMs / 1000)}s.`);
    }
    throw new Error("Unauthorized");
  }
}

export type TrafficDay = {
  date: string;
  requests: number;
  pageViews: number;
  uniques: number;
  threats: number;
  bytes: number;
};

// Top-level sections we can distinguish by URL path alone. Subcategories
// (class/subject/chapter) live in search params on these same routes, and
// Cloudflare's path dimension strips the query string, so only this
// top-level split is possible without a custom tracker — see admin.tsx for
// the user-facing note explaining that limitation.
const SECTION_DEFS = [
  { label: "Doxxmarks", prefix: "/doxxmarks" },
  { label: "Resources", prefix: "/resources" },
] as const;

export type SectionBreakdownItem = { label: string; path: string; visits: number };

export type AdminTrafficResult =
  | { configured: true; days: TrafficDay[]; sections: SectionBreakdownItem[]; cache: { hit: boolean; fetchedAt: string } }
  | { configured: false; reason: string };

const CLOUDFLARE_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const TRAFFIC_QUERY = `
  query GetTrafficData($zoneTag: String!, $since: String!, $until: String!, $sinceDT: Time!, $untilDT: Time!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        dailyTraffic: httpRequests1dGroups(
          limit: 30,
          filter: { date_geq: $since, date_lt: $until },
          orderBy: [date_ASC]
        ) {
          dimensions { date }
          sum {
            requests
            pageViews
            bytes
            threats
          }
          uniq { uniques }
        }
        sectionBreakdown: httpRequestsAdaptiveGroups(
          limit: 1000,
          filter: {
            datetime_geq: $sinceDT,
            datetime_lt: $untilDT,
            requestSource: "eyeball",
            OR: [
              { clientRequestPath_like: "/doxxmarks%" },
              { clientRequestPath_like: "/resources%" }
            ]
          }
        ) {
          sum { visits }
          dimensions { clientRequestPath }
        }
      }
    }
  }
`;

type CloudflareGraphQLResponse = {
  data?: {
    viewer?: {
      zones?: Array<{
        dailyTraffic?: Array<{
          dimensions: { date: string };
          sum: { requests: number; pageViews: number; bytes: number; threats: number };
          uniq: { uniques: number };
        }>;
        sectionBreakdown?: Array<{
          sum: { visits: number };
          dimensions: { clientRequestPath: string };
        }>;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export const checkAdminPasscode = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }) => {
    const result = verifyPasscode(data.passcode);
    if (result.lockedOutMs) {
      return { ok: false, lockedOutSeconds: Math.ceil(result.lockedOutMs / 1000) };
    }
    return { ok: result.ok };
  });

type CachedPayload = { days: TrafficDay[]; sections: SectionBreakdownItem[] };

/**
 * Reads the single-row Cloudflare analytics cache from Neon. Returns null
 * if the row doesn't exist yet, or if `sql` isn't configured (no
 * DATABASE_URL) — callers should fall back to a live Cloudflare fetch in
 * either case.
 */
async function readCache(): Promise<{ payload: CachedPayload; fetchedAt: Date } | null> {
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT payload, fetched_at FROM cloudflare_analytics_cache WHERE id = true LIMIT 1`
  );
  const row = rows[0] as { payload: CachedPayload; fetched_at: string } | undefined;
  if (!row) return null;
  return { payload: row.payload, fetchedAt: new Date(row.fetched_at) };
}

/**
 * Upserts the single-row Cloudflare analytics cache on Neon with a fresh
 * timestamp. No-ops silently if `sql` isn't configured, so a missing
 * DATABASE_URL degrades to "always fetch live" rather than crashing.
 */
async function writeCache(payload: CachedPayload): Promise<void> {
  if (!sql) return;
  await sql.query(
    `INSERT INTO cloudflare_analytics_cache (id, payload, fetched_at)
     VALUES (true, $1, now())
     ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [JSON.stringify(payload)]
  );
}

/**
 * Calls Cloudflare's GraphQL Analytics API for the last 30 days of
 * zone-level traffic plus the doxxmarks/resources section breakdown.
 * Returns `configured: false` (never throws) when credentials are missing
 * or the request/response fails, so the admin UI can show a clear setup
 * state instead of a generic error.
 */
async function fetchFromCloudflare(): Promise<AdminTrafficResult> {
  const zoneId = process.env["CLOUDFLARE_ZONE_ID"];
  const apiToken = process.env["CLOUDFLARE_API_TOKEN"];

  if (!zoneId || !apiToken) {
    return {
      configured: false,
      reason:
        "Cloudflare analytics isn't configured yet. Set CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN (Zone → Analytics → Read) in the environment.",
    };
  }

  const until = new Date();
  const since = new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000);

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: TRAFFIC_QUERY,
        variables: {
          zoneTag: zoneId,
          since: since.toISOString().slice(0, 10),
          until: until.toISOString().slice(0, 10),
          sinceDT: since.toISOString(),
          untilDT: until.toISOString(),
        },
      }),
    });
  } catch (error) {
    return {
      configured: false,
      reason: `Could not reach Cloudflare's API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const json = (await response.json()) as CloudflareGraphQLResponse;

  if (json.errors?.length) {
    return { configured: false, reason: json.errors[0]?.message ?? "Cloudflare API returned an error." };
  }

  const zone = json.data?.viewer?.zones?.[0];
  const groups = zone?.dailyTraffic ?? [];
  const pathRows = zone?.sectionBreakdown ?? [];

  // Bucket raw path rows (one per distinct path) into the two known
  // top-level sections by prefix match, since the dataset can't group by
  // prefix itself — only by exact dimension value.
  const sections: SectionBreakdownItem[] = SECTION_DEFS.map((def) => ({
    label: def.label,
    path: def.prefix,
    visits: pathRows
      .filter((r) => r.dimensions.clientRequestPath.startsWith(def.prefix))
      .reduce((sum, r) => sum + r.sum.visits, 0),
  }));

  const days: TrafficDay[] = groups.map((g) => ({
    date: g.dimensions.date,
    requests: g.sum.requests,
    pageViews: g.sum.pageViews,
    uniques: g.uniq.uniques,
    threats: g.sum.threats,
    bytes: g.sum.bytes,
  }));

  return { configured: true, days, sections, cache: { hit: false, fetchedAt: new Date().toISOString() } };
}

/**
 * Returns the last 30 days of Cloudflare traffic + section breakdown,
 * backed by a 5-minute Neon cache: a fresh cache row is served directly
 * from the database; a stale or missing row triggers a live Cloudflare
 * fetch, whose result is written back to the cache before returning.
 * Requires CLOUDFLARE_ZONE_ID and CLOUDFLARE_API_TOKEN (Zone -> Analytics
 * -> Read scope) in the server environment.
 */
export const getAdminTraffic = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminTrafficResult> => {
    requirePasscode(data.passcode);

    try {
      const cached = await readCache();
      if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
        return {
          configured: true,
          days: cached.payload.days,
          sections: cached.payload.sections,
          cache: { hit: true, fetchedAt: cached.fetchedAt.toISOString() },
        };
      }
    } catch (error) {
      // Cache read failures (e.g. Neon unreachable) shouldn't block the
      // dashboard — fall through to a live Cloudflare fetch instead.
      console.error("[admin] cache read failed, fetching live:", error);
    }

    const result = await fetchFromCloudflare();

    if (result.configured) {
      try {
        await writeCache({ days: result.days, sections: result.sections });
      } catch (error) {
        // A failed cache write shouldn't fail the request — the UI still
        // gets fresh data this time, it just won't be cached for next time.
        console.error("[admin] cache write failed:", error);
      }
    }

    return result;
  });

// ---------------------------------------------------------------------
// Manage Resources panel: real-time Drive folder listing + upload, backed
// by the service-account credentials + target folder ID stored in Neon
// (table: drive_integration) — never the static committed JSON datasets.
// ---------------------------------------------------------------------

export type ManageResourcesResult =
  | { configured: true; files: DriveFileEntry[] }
  | { configured: false; reason: string };

export const getManageResources = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; folderId?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (d.folderId !== undefined && typeof d.folderId !== "string") throw new Error("Invalid folderId");
    // Drive IDs are letters/digits/'-'/'_' only. Rejecting anything else
    // here keeps a crafted value from ever reaching the Drive query
    // builder, where it would be interpolated into a `q` expression.
    if (typeof d.folderId === "string" && !isDriveId(d.folderId)) {
      throw new Error("Invalid folderId: expected a Drive folder ID");
    }
    return { passcode: d.passcode, folderId: d.folderId as string | undefined };
  })
  .handler(async ({ data }): Promise<ManageResourcesResult> => {
    requirePasscode(data.passcode);

    const config = await getDriveIntegrationConfig();
    if (!config) {
      return {
        configured: false,
        reason:
          "Drive integration isn't configured yet. The admin needs to seed the drive_integration row (service account JSON + folder ID) in Neon.",
      };
    }

    try {
      const files = await listDriveFolderFiles(config, data.folderId);
      return { configured: true, files };
    } catch (error) {
      return {
        configured: false,
        reason: `Could not list the Drive folder: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

export type UploadResourceResult =
  | { ok: true; file: DriveFileEntry }
  | { ok: false; reason: string };

export const uploadResource = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    const passcode = data.get("passcode");
    const file = data.get("file");
    if (typeof passcode !== "string") throw new Error("Missing passcode");
    if (!(file instanceof File)) throw new Error("Missing file");
    return { passcode, file };
  })
  .handler(async ({ data }): Promise<UploadResourceResult> => {
    requirePasscode(data.passcode);

    // Disabled: this folder is "shared with Editor access" rather than a
    // Shared Drive. Google rejects file *creation* from service accounts
    // in a regular My Drive folder with storageQuotaExceeded, even with
    // Editor permission — only a Shared Drive (storage owned by the
    // Drive itself) or domain-wide delegation lets a service account own
    // new content. Re-enable this handler once the target folder has
    // been moved into a Shared Drive.
    return {
      ok: false,
      reason:
        "Uploads are disabled: Google blocks service-account uploads to a regular \"shared with me\" folder " +
        "(storageQuotaExceeded). Move the folder into a Shared Drive to enable this.",
    };
  });

// ---------------------------------------------------------------------
// "Update resource datasets" button: dispatches the update-resources.yml
// GitHub Actions workflow (re-crawls Drive, regenerates the committed
// JSON datasets, commits them back) and reports its live progress, using
// the GitHub PAT + repo stored in Neon (table: github_integration).
// ---------------------------------------------------------------------

export type TriggerDatasetUpdateResult =
  | { ok: true; runId: number; htmlUrl: string }
  | { ok: false; reason: string };

export const triggerDatasetUpdate = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<TriggerDatasetUpdateResult> => {
    requirePasscode(data.passcode);

    const config = await getGithubIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "GitHub integration isn't configured yet (missing github_integration row in Neon)." };
    }

    try {
      const { runId, htmlUrl } = await dispatchWorkflow(config);
      return { ok: true, runId, htmlUrl };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

// ---------------------------------------------------------------------
// Ratings & Feedback tables: read-only admin views over resource_ratings
// and resource_feedback (see ratings-server.ts / feedback-server.ts for
// the viewer-facing write side). Each row surfaces the Drive file id plus
// a direct Drive link so an admin can jump straight to the file being
// rated/discussed without cross-referencing the resource datasets.
// ---------------------------------------------------------------------

export type AdminRatingRow = {
  fileId: string;
  driveUrl: string;
  average: number;
  count: number;
  lastRatedAt: string;
};

export type AdminFeedbackRow = {
  id: number;
  fileId: string;
  driveUrl: string;
  feedback: string;
  createdAt: string;
};

export type AdminFeedbackResult =
  | { configured: true; ratings: AdminRatingRow[]; feedback: AdminFeedbackRow[] }
  | { configured: false; reason: string };

const FEEDBACK_ROW_LIMIT = 200;

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/**
 * Returns every file's aggregate rating plus the most recent feedback
 * entries, for the admin "Ratings & Feedback" panel. Read-only: neither
 * table is ever mutated here.
 */
export const getAdminResourceFeedback = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminFeedbackResult> => {
    requirePasscode(data.passcode);

    if (!sql) {
      return { configured: false, reason: "Database isn't configured (missing DATABASE_URL)." };
    }

    try {
      const ratingRows = await sql.query(
        `SELECT file_id, AVG(rating)::float AS average, COUNT(*)::int AS count, MAX(updated_at) AS last_rated_at
         FROM resource_ratings
         GROUP BY file_id
         ORDER BY last_rated_at DESC`
      );
      const feedbackRows = await sql.query(
        `SELECT id, file_id, feedback, created_at
         FROM resource_feedback
         ORDER BY created_at DESC
         LIMIT $1`,
        [FEEDBACK_ROW_LIMIT]
      );

      const ratings: AdminRatingRow[] = (
        ratingRows as Array<{ file_id: string; average: number; count: number; last_rated_at: string }>
      ).map((r) => ({
        fileId: r.file_id,
        driveUrl: driveFileUrl(r.file_id),
        average: r.average,
        count: r.count,
        lastRatedAt: r.last_rated_at,
      }));

      const feedback: AdminFeedbackRow[] = (
        feedbackRows as Array<{ id: number; file_id: string; feedback: string; created_at: string }>
      ).map((r) => ({
        id: r.id,
        fileId: r.file_id,
        driveUrl: driveFileUrl(r.file_id),
        feedback: r.feedback,
        createdAt: r.created_at,
      }));

      return { configured: true, ratings, feedback };
    } catch (error) {
      return {
        configured: false,
        reason: `Could not load ratings/feedback: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

export type DatasetUpdateStatusResult =
  | { ok: true; status: WorkflowRunStatus }
  | { ok: false; reason: string };

export const getDatasetUpdateStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; runId?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (typeof d?.runId !== "number") throw new Error("Missing runId");
    return { passcode: d.passcode, runId: d.runId };
  })
  .handler(async ({ data }): Promise<DatasetUpdateStatusResult> => {
    requirePasscode(data.passcode);

    const config = await getGithubIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "GitHub integration isn't configured yet." };
    }

    try {
      const status = await getWorkflowRunStatus(config, data.runId);
      return { ok: true, status };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

