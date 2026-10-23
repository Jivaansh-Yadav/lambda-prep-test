import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";
import {
  getDriveIntegrationConfig,
  isDriveId,
  listDriveFolderFiles,
  uploadDriveFile,
  renameDriveFile,
  trashDriveFile,
  hasOAuthCredentials,
  type DriveFileEntry,
} from "./drive-integration-server";
import {
  getGithubIntegrationConfig,
  dispatchWorkflow,
  getWorkflowRunStatus,
  getLatestCommit,
  type WorkflowRunStatus,
  type LatestCommit,
} from "./github-integration-server";
import { getCloudflareIntegrationConfig } from "./cloudflare-integration-server";
import { resolveFileLocations } from "./resource-lookup-server";

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

export const requirePasscode = createServerOnlyFn((passcode: string) => {
  const { ok, lockedOutMs } = verifyPasscode(passcode);
  if (!ok) {
    if (lockedOutMs) {
      throw new Error(`Too many attempts. Try again in ${Math.ceil(lockedOutMs / 1000)}s.`);
    }
    throw new Error("Unauthorized");
  }
});

// Daily bucket for the traffic chart. Both numbers come from the same
// account-scoped Web Analytics (RUM) dataset the beacon in __root.tsx
// reports to: `pageLoads` is the raw RUM event count (every page load the
// beacon recorded), `visits` is Cloudflare's own `sum.visits` (page loads
// whose referrer was a different site — i.e. not internal navigation).
// RUM doesn't expose a separate unique-visitor count, so there's no third
// number here.
export type TrafficDay = {
  date: string;
  pageLoads: number;
  visits: number;
};

// Selectable lookback windows for the Deep analytics traffic chart +
// Web Analytics (RUM) detail panel. "24h" buckets by hour
// (datetimeHour) since a day has too few points to chart meaningfully by
// day; the other three bucket by calendar day (date) same as before.
export const ADMIN_RANGES = ["24h", "7d", "14d", "30d"] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

function isAdminRange(value: unknown): value is AdminRange {
  return typeof value === "string" && (ADMIN_RANGES as readonly string[]).includes(value);
}

const RANGE_WINDOW_MS: Record<AdminRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export const ADMIN_RANGE_LABEL: Record<AdminRange, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
};

// Row limit for the per-bucket traffic query: 24h buckets by hour (24
// points max), the rest bucket by day (up to 30 points max).
const RANGE_BUCKET_LIMIT: Record<AdminRange, number> = {
  "24h": 25,
  "7d": 8,
  "14d": 15,
  "30d": 31,
};

// Top-level sections we can distinguish by URL path alone. Subcategories
// (class/subject/chapter) live in search params on these same routes, and
// the RUM path dimension strips the query string, so only this top-level
// split is possible without a custom tracker — see admin.tsx for the
// user-facing note explaining that limitation.
const SECTION_DEFS = [
  { label: "Doxxmarks", prefix: "/doxxmarks" },
  { label: "Resources", prefix: "/resources" },
] as const;

export type SectionBreakdownItem = { label: string; path: string; visits: number };

export type AdminTrafficResult =
  | { configured: true; days: TrafficDay[]; sections: SectionBreakdownItem[]; cache: { hit: boolean; fetchedAt: string } }
  | { configured: false; reason: string };

const CLOUDFLARE_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// Account-scoped Web Analytics (RUM) query — reads the same beacon data
// (keyed by siteTag, not zoneTag) that getAdminRum below drills into for
// the top-pages/countries/devices detail. Needs the account ID, a RUM
// API token (Account -> Analytics -> Read) and the site tag, all read
// from the cloudflare_integration row on Neon (see
// getCloudflareIntegrationConfig), not a Zone ID/zone-scoped token —
// Cloudflare's legacy httpRequests*/zone-level analytics requires a Zone
// ID + Zone Analytics Read token this project doesn't have, whereas the
// RUM beacon
// + Account Analytics Read token work from a single Cloudflare account.
// Two variants of the same query, differing only in which time
// dimension dailyTraffic buckets by: "date" (one point per calendar day)
// for the 7d/14d/30d ranges, or "datetimeHour" (one point per hour) for
// 24h, since a single day has too few calendar-day points to chart.
const TRAFFIC_QUERY_BY_DAY = `
  query GetTrafficData($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!, $limit: Int!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        dailyTraffic: rumPageloadEventsAdaptiveGroups(
          limit: $limit,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [date_ASC]
        ) {
          count
          sum { visits }
          dimensions { bucket: date }
        }
        sectionBreakdown: rumPageloadEventsAdaptiveGroups(
          limit: 1000,
          filter: {
            siteTag: $siteTag,
            datetime_geq: $since,
            datetime_lt: $until,
            OR: [
              { requestPath_like: "/doxxmarks%" },
              { requestPath_like: "/resources%" }
            ]
          }
        ) {
          sum { visits }
          dimensions { requestPath }
        }
      }
    }
  }
`;

const TRAFFIC_QUERY_BY_HOUR = `
  query GetTrafficData($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!, $limit: Int!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        dailyTraffic: rumPageloadEventsAdaptiveGroups(
          limit: $limit,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [datetimeHour_ASC]
        ) {
          count
          sum { visits }
          dimensions { bucket: datetimeHour }
        }
        sectionBreakdown: rumPageloadEventsAdaptiveGroups(
          limit: 1000,
          filter: {
            siteTag: $siteTag,
            datetime_geq: $since,
            datetime_lt: $until,
            OR: [
              { requestPath_like: "/doxxmarks%" },
              { requestPath_like: "/resources%" }
            ]
          }
        ) {
          sum { visits }
          dimensions { requestPath }
        }
      }
    }
  }
`;

type CloudflareGraphQLResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        dailyTraffic?: Array<{
          count: number;
          dimensions: { bucket: string };
          sum: { visits: number };
        }>;
        sectionBreakdown?: Array<{
          sum: { visits: number };
          dimensions: { requestPath: string };
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
 * Reads the per-range Cloudflare analytics cache row from Neon. Returns
 * null if no row exists yet for this range, or if `sql` isn't configured
 * (no DATABASE_URL) — callers should fall back to a live Cloudflare fetch
 * in either case.
 */
async function readCache(range: AdminRange): Promise<{ payload: CachedPayload; fetchedAt: Date } | null> {
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT payload, fetched_at FROM cloudflare_analytics_cache WHERE range = $1 LIMIT 1`,
    [range]
  );
  const row = rows[0] as { payload: CachedPayload; fetched_at: string } | undefined;
  if (!row) return null;
  return { payload: row.payload, fetchedAt: new Date(row.fetched_at) };
}

/**
 * Upserts the per-range Cloudflare analytics cache row on Neon with a
 * fresh timestamp. No-ops silently if `sql` isn't configured, so a
 * missing DATABASE_URL degrades to "always fetch live" rather than
 * crashing.
 */
async function writeCache(range: AdminRange, payload: CachedPayload): Promise<void> {
  if (!sql) return;
  await sql.query(
    `INSERT INTO cloudflare_analytics_cache (range, payload, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (range) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [range, JSON.stringify(payload)]
  );
}

/**
 * Calls Cloudflare's GraphQL Analytics API for Web Analytics (RUM)
 * traffic plus the doxxmarks/resources section breakdown, over the given
 * lookback window. Returns `configured: false` (never throws) when
 * credentials are missing or the request/response fails, so the admin UI
 * can show a clear setup state instead of a generic error.
 */
async function fetchFromCloudflare(range: AdminRange): Promise<AdminTrafficResult> {
  const config = await getCloudflareIntegrationConfig();

  if (!config) {
    return {
      configured: false,
      reason:
        "Web Analytics isn't configured yet. Seed the cloudflare_integration row (account ID, RUM API token with Account → Analytics → Read scope, and RUM site tag) in Neon.",
    };
  }
  const { accountId, rumApiToken: apiToken, rumSiteTag: siteTag } = config;

  const until = new Date();
  const since = new Date(until.getTime() - RANGE_WINDOW_MS[range]);

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: range === "24h" ? TRAFFIC_QUERY_BY_HOUR : TRAFFIC_QUERY_BY_DAY,
        variables: {
          accountTag: accountId,
          siteTag,
          since: since.toISOString(),
          until: until.toISOString(),
          limit: RANGE_BUCKET_LIMIT[range],
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

  const account = json.data?.viewer?.accounts?.[0];
  const groups = account?.dailyTraffic ?? [];
  const pathRows = account?.sectionBreakdown ?? [];

  // Bucket raw path rows (one per distinct path) into the two known
  // top-level sections by prefix match, since the dataset can't group by
  // prefix itself — only by exact dimension value.
  const sections: SectionBreakdownItem[] = SECTION_DEFS.map((def) => ({
    label: def.label,
    path: def.prefix,
    visits: pathRows
      .filter((r) => r.dimensions.requestPath.startsWith(def.prefix))
      .reduce((sum, r) => sum + r.sum.visits, 0),
  }));

  const days: TrafficDay[] = groups.map((g) => ({
    date: g.dimensions.bucket,
    pageLoads: g.count,
    visits: g.sum.visits,
  }));

  return { configured: true, days, sections, cache: { hit: false, fetchedAt: new Date().toISOString() } };
}

/**
 * Returns Web Analytics (RUM) traffic + section breakdown for the
 * requested lookback window (24h/7d/14d/30d, default 30d), backed by a
 * 5-minute Neon cache keyed per range: a fresh cache row for that range is
 * served directly from the database; a stale or missing row triggers a
 * live Cloudflare fetch, whose result is written back to the cache before
 * returning. Requires the cloudflare_integration row (account ID,
 * RUM API token with Account -> Analytics -> Read scope, and site tag)
 * to be seeded on Neon.
 */
export const getAdminTraffic = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; range?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (d.range !== undefined && !isAdminRange(d.range)) throw new Error("Invalid range");
    return { passcode: d.passcode, range: (d.range as AdminRange | undefined) ?? "30d" };
  })
  .handler(async ({ data }): Promise<AdminTrafficResult> => {
    requirePasscode(data.passcode);
    const range = data.range;

    try {
      const cached = await readCache(range);
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

    const result = await fetchFromCloudflare(range);

    if (result.configured) {
      try {
        await writeCache(range, { days: result.days, sections: result.sections });
      } catch (error) {
        // A failed cache write shouldn't fail the request — the UI still
        // gets fresh data this time, it just won't be cached for next time.
        console.error("[admin] cache write failed:", error);
      }
    }

    return result;
  });

// ---------------------------------------------------------------------
// Deep analytics detail: top pages, countries, devices, browsers and
// referrers for the same Web Analytics (RUM) dataset fetchFromCloudflare
// above uses for the chart/KPIs — this just adds the breakdown panels,
// sharing the same cloudflare_integration credentials from Neon.
// ---------------------------------------------------------------------

export type RumBreakdownItem = { label: string; visits: number };

export type AdminRumResult =
  | {
      configured: true;
      totalVisits: number;
      topPaths: RumBreakdownItem[];
      topCountries: RumBreakdownItem[];
      topDeviceTypes: RumBreakdownItem[];
      topBrowsers: RumBreakdownItem[];
      topReferrers: RumBreakdownItem[];
      cache: { hit: boolean; fetchedAt: string };
    }
  | { configured: false; reason: string };

const RUM_QUERY = `
  query GetRumData($accountTag: String!, $siteTag: String!, $since: Time!, $until: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        total: rumPageloadEventsAdaptiveGroups(
          limit: 1,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until }
        ) {
          sum { visits }
        }
        topPaths: rumPageloadEventsAdaptiveGroups(
          limit: 10,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [sum_visits_DESC]
        ) {
          sum { visits }
          dimensions { metric: requestPath }
        }
        topCountries: rumPageloadEventsAdaptiveGroups(
          limit: 10,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [sum_visits_DESC]
        ) {
          sum { visits }
          dimensions { metric: countryName }
        }
        topDeviceTypes: rumPageloadEventsAdaptiveGroups(
          limit: 10,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [sum_visits_DESC]
        ) {
          sum { visits }
          dimensions { metric: deviceType }
        }
        topBrowsers: rumPageloadEventsAdaptiveGroups(
          limit: 10,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [sum_visits_DESC]
        ) {
          sum { visits }
          dimensions { metric: userAgentBrowser }
        }
        topReferrers: rumPageloadEventsAdaptiveGroups(
          limit: 10,
          filter: { siteTag: $siteTag, datetime_geq: $since, datetime_lt: $until },
          orderBy: [sum_visits_DESC]
        ) {
          sum { visits }
          dimensions { metric: refererHost }
        }
      }
    }
  }
`;

type RumGroup = { sum: { visits: number }; dimensions: { metric: string } };

type RumGraphQLResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        total?: Array<{ sum: { visits: number } }>;
        topPaths?: RumGroup[];
        topCountries?: RumGroup[];
        topDeviceTypes?: RumGroup[];
        topBrowsers?: RumGroup[];
        topReferrers?: RumGroup[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

type CachedRumPayload = Omit<Extract<AdminRumResult, { configured: true }>, "cache" | "configured">;

/** Reads the per-range RUM analytics cache row from Neon, mirroring
 * readCache() above for the traffic cache. */
async function readRumCache(range: AdminRange): Promise<{ payload: CachedRumPayload; fetchedAt: Date } | null> {
  if (!sql) return null;
  const rows = await sql.query(
    `SELECT payload, fetched_at FROM cloudflare_rum_cache WHERE range = $1 LIMIT 1`,
    [range]
  );
  const row = rows[0] as { payload: CachedRumPayload; fetched_at: string } | undefined;
  if (!row) return null;
  return { payload: row.payload, fetchedAt: new Date(row.fetched_at) };
}

/** Upserts the per-range RUM analytics cache row on Neon, mirroring
 * writeCache() above. No-ops silently without DATABASE_URL. */
async function writeRumCache(range: AdminRange, payload: CachedRumPayload): Promise<void> {
  if (!sql) return;
  await sql.query(
    `INSERT INTO cloudflare_rum_cache (range, payload, fetched_at)
     VALUES ($1, $2, now())
     ON CONFLICT (range) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [range, JSON.stringify(payload)]
  );
}

function sortedBreakdown(groups: RumGroup[] | undefined): RumBreakdownItem[] {
  return (groups ?? [])
    .map((g) => ({ label: g.dimensions.metric || "(unknown)", visits: g.sum.visits }))
    .sort((a, b) => b.visits - a.visits);
}

/**
 * Calls Cloudflare's GraphQL Analytics API for Web Analytics (RUM)
 * detail — top pages, countries, device types, browsers and referrers —
 * over the given lookback window, scoped by the beacon's site tag.
 * Returns `configured: false` (never throws) when credentials are
 * missing or the request/response fails.
 */
async function fetchRumFromCloudflare(range: AdminRange): Promise<AdminRumResult> {
  const config = await getCloudflareIntegrationConfig();

  if (!config) {
    return {
      configured: false,
      reason:
        "Web Analytics (RUM) isn't configured yet. Seed the cloudflare_integration row (account ID, RUM API token with Account → Analytics → Read scope, and RUM site tag) in Neon.",
    };
  }
  const { accountId, rumApiToken: apiToken, rumSiteTag: siteTag } = config;

  const until = new Date();
  const since = new Date(until.getTime() - RANGE_WINDOW_MS[range]);

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: RUM_QUERY,
        variables: {
          accountTag: accountId,
          siteTag,
          since: since.toISOString(),
          until: until.toISOString(),
        },
      }),
    });
  } catch (error) {
    return {
      configured: false,
      reason: `Could not reach Cloudflare's API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const json = (await response.json()) as RumGraphQLResponse;

  if (json.errors?.length) {
    return { configured: false, reason: json.errors[0]?.message ?? "Cloudflare API returned an error." };
  }

  const account = json.data?.viewer?.accounts?.[0];
  if (!account) {
    return {
      configured: false,
      reason: "Cloudflare API returned no account data — check the account ID and the token's permissions in the cloudflare_integration row.",
    };
  }

  const totalVisits = account.total?.[0]?.sum.visits ?? 0;

  return {
    configured: true,
    totalVisits,
    topPaths: sortedBreakdown(account.topPaths),
    topCountries: sortedBreakdown(account.topCountries),
    topDeviceTypes: sortedBreakdown(account.topDeviceTypes),
    topBrowsers: sortedBreakdown(account.topBrowsers),
    topReferrers: sortedBreakdown(account.topReferrers),
    cache: { hit: false, fetchedAt: new Date().toISOString() },
  };
}

/**
 * Returns Web Analytics (RUM) detail for the requested lookback window
 * (24h/7d/14d/30d, default 30d), backed by a 5-minute Neon cache keyed
 * per range (same TTL/pattern as getAdminTraffic above). Requires the
 * cloudflare_integration row (account ID, RUM API token with Account ->
 * Analytics -> Read scope, and site tag) to be seeded on Neon.
 */
export const getAdminRum = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; range?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (d.range !== undefined && !isAdminRange(d.range)) throw new Error("Invalid range");
    return { passcode: d.passcode, range: (d.range as AdminRange | undefined) ?? "30d" };
  })
  .handler(async ({ data }): Promise<AdminRumResult> => {
    requirePasscode(data.passcode);
    const range = data.range;

    try {
      const cached = await readRumCache(range);
      if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
        return { configured: true, ...cached.payload, cache: { hit: true, fetchedAt: cached.fetchedAt.toISOString() } };
      }
    } catch (error) {
      console.error("[admin] RUM cache read failed, fetching live:", error);
    }

    const result = await fetchRumFromCloudflare(range);

    if (result.configured) {
      try {
        const { cache, configured, ...payload } = result;
        void cache;
        void configured;
        await writeRumCache(range, payload);
      } catch (error) {
        console.error("[admin] RUM cache write failed:", error);
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
  | { configured: true; files: DriveFileEntry[]; rootFolderUrl: string }
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
      return {
        configured: true,
        files,
        rootFolderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(config.folderId)}`,
      };
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

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB — generous for PDFs/docs/slides, keeps the request body sane

export const uploadResource = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    const passcode = data.get("passcode");
    const file = data.get("file");
    const folderId = data.get("folderId");
    if (typeof passcode !== "string") throw new Error("Missing passcode");
    if (!(file instanceof File)) throw new Error("Missing file");
    if (folderId !== null && typeof folderId !== "string") throw new Error("Invalid folderId");
    if (typeof folderId === "string" && folderId && !isDriveId(folderId)) {
      throw new Error("Invalid folderId: expected a Drive folder ID");
    }
    return { passcode, file, folderId: (folderId as string | null) || undefined };
  })
  .handler(async ({ data }): Promise<UploadResourceResult> => {
    requirePasscode(data.passcode);

    const config = await getDriveIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "Drive integration isn't configured yet." };
    }

    if (data.file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, reason: `File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).` };
    }

    try {
      const arrayBuffer = await data.file.arrayBuffer();
      const file = await uploadDriveFile(
        config,
        { name: data.file.name, mimeType: data.file.type || "application/octet-stream", data: arrayBuffer },
        data.folderId
      );
      return { ok: true, file };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

export type RenameResourceResult = { ok: true; file: DriveFileEntry } | { ok: false; reason: string };

export const renameResource = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; fileId?: unknown; newName?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (typeof d?.fileId !== "string" || !isDriveId(d.fileId)) throw new Error("Invalid fileId");
    if (typeof d?.newName !== "string" || !d.newName.trim()) throw new Error("Missing newName");
    return { passcode: d.passcode, fileId: d.fileId, newName: d.newName.trim() };
  })
  .handler(async ({ data }): Promise<RenameResourceResult> => {
    requirePasscode(data.passcode);

    const config = await getDriveIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "Drive integration isn't configured yet." };
    }

    try {
      const file = await renameDriveFile(config, data.fileId, data.newName);
      return { ok: true, file };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

export type DeleteResourceResult = { ok: true } | { ok: false; reason: string };

export const deleteResource = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; fileId?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (typeof d?.fileId !== "string" || !isDriveId(d.fileId)) throw new Error("Invalid fileId");
    return { passcode: d.passcode, fileId: d.fileId };
  })
  .handler(async ({ data }): Promise<DeleteResourceResult> => {
    requirePasscode(data.passcode);

    const config = await getDriveIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "Drive integration isn't configured yet." };
    }

    try {
      await trashDriveFile(config, data.fileId);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

/** Whether a real Google account (not just the Neon service account) is
 * configured for Drive writes — surfaced to the admin UI so it can show
 * an accurate explanation if uploads/rename/delete fail for lack of one. */
export const getDriveWriteCapability = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<{ hasOAuth: boolean }> => {
    requirePasscode(data.passcode);
    const config = await getDriveIntegrationConfig();
    return { hasOAuth: hasOAuthCredentials(config) };
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
  fileName: string;
  classLabel: string;
  driveUrl: string;
  average: number;
  count: number;
  lastRatedAt: string;
};

export type AdminFeedbackRow = {
  id: number;
  fileId: string;
  fileName: string;
  classLabel: string;
  driveUrl: string;
  feedback: string;
  createdAt: string;
};

export type AdminViewRow = {
  fileId: string;
  fileName: string;
  classLabel: string;
  driveUrl: string;
  viewCount: number;
  lastViewedAt: string;
};

export type AdminShareRow = {
  fileId: string;
  fileName: string;
  classLabel: string;
  driveUrl: string;
  shareCount: number;
  lastSharedAt: string;
};

export type AdminResourceStatsResult =
  | { configured: true; ratings: AdminRatingRow[]; feedback: AdminFeedbackRow[]; views: AdminViewRow[]; shares: AdminShareRow[] }
  | { configured: false; reason: string };

const FEEDBACK_ROW_LIMIT = 200;

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/**
 * Returns every file's aggregate rating, view count and share count, plus
 * the most recent feedback entries, for the admin "Resource stats" panel.
 * Read-only: none of the four tables is ever mutated here.
 */
export const getAdminResourceStats = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminResourceStatsResult> => {
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
      const viewRows = await sql.query(
        `SELECT file_id, view_count, last_viewed_at FROM resource_views ORDER BY last_viewed_at DESC`
      );
      const shareRows = await sql.query(
        `SELECT file_id, share_count, last_shared_at FROM resource_shares ORDER BY last_shared_at DESC`
      );

      // Resolve every distinct file id across all four tables to its
      // display name + class in one pass, so admins see what a file
      // actually is instead of a bare Drive id.
      const allFileIds = new Set<string>();
      for (const r of ratingRows as Array<{ file_id: string }>) allFileIds.add(r.file_id);
      for (const r of feedbackRows as Array<{ file_id: string }>) allFileIds.add(r.file_id);
      for (const r of viewRows as Array<{ file_id: string }>) allFileIds.add(r.file_id);
      for (const r of shareRows as Array<{ file_id: string }>) allFileIds.add(r.file_id);
      const locations = await resolveFileLocations([...allFileIds]);
      const locate = (fileId: string) => locations.get(fileId) ?? { name: "Unknown file", classLabel: "Unknown class" };

      const ratings: AdminRatingRow[] = (
        ratingRows as Array<{ file_id: string; average: number; count: number; last_rated_at: string }>
      ).map((r) => ({
        fileId: r.file_id,
        fileName: locate(r.file_id).name,
        classLabel: locate(r.file_id).classLabel,
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
        fileName: locate(r.file_id).name,
        classLabel: locate(r.file_id).classLabel,
        driveUrl: driveFileUrl(r.file_id),
        feedback: r.feedback,
        createdAt: r.created_at,
      }));

      const views: AdminViewRow[] = (
        viewRows as Array<{ file_id: string; view_count: number; last_viewed_at: string }>
      ).map((r) => ({
        fileId: r.file_id,
        fileName: locate(r.file_id).name,
        classLabel: locate(r.file_id).classLabel,
        driveUrl: driveFileUrl(r.file_id),
        viewCount: r.view_count,
        lastViewedAt: r.last_viewed_at,
      }));

      const shares: AdminShareRow[] = (
        shareRows as Array<{ file_id: string; share_count: number; last_shared_at: string }>
      ).map((r) => ({
        fileId: r.file_id,
        fileName: locate(r.file_id).name,
        classLabel: locate(r.file_id).classLabel,
        driveUrl: driveFileUrl(r.file_id),
        shareCount: r.share_count,
        lastSharedAt: r.last_shared_at,
      }));

      return { configured: true, ratings, feedback, views, shares };
    } catch (error) {
      return {
        configured: false,
        reason: `Could not load resource stats: ${error instanceof Error ? error.message : String(error)}`,
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

// ---------------------------------------------------------------------
// "Latest commit" admin card: surfaces the most recent commit on the
// configured ref (see github_integration in Neon), using the same PAT
// already stored for the dataset-update workflow dispatch above.
// ---------------------------------------------------------------------

export type AdminLatestCommitResult =
  | { ok: true; commit: LatestCommit }
  | { ok: false; reason: string };

export const getAdminLatestCommit = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminLatestCommitResult> => {
    requirePasscode(data.passcode);

    const config = await getGithubIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "GitHub integration isn't configured yet." };
    }

    try {
      const commit = await getLatestCommit(config);
      return { ok: true, commit };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  });

