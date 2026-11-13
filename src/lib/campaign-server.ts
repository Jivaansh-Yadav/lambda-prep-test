import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";

// ---------------------------------------------------------------------
// Campaign attribution (table: campaign_visits).
//
// Cloudflare Web Analytics cannot answer "which link did this visit come
// from": Reddit, Discord, Slack and Gmail all strip the referrer, and the
// RUM dataset drops query strings entirely, so `?utm_source=reddit` never
// reaches it. This module is the app's own answer — the tagged query string
// is read in the browser (campaign-tracking.ts), stored once per session per
// distinct campaign link, and written here, so the admin panel can report
// sessions by source/medium/campaign regardless of what the browser leaked.
//
// One row per arrival, not per page view: the client records at most one row
// per session for a given set of utm values, so COUNT(*) reads as "sessions
// that arrived from this link" rather than inflating on internal navigation.
// ---------------------------------------------------------------------

/** Max stored length per field — long enough for real campaign names, short
 * enough that a hostile URL can't write megabytes into the table. */
const MAX_LENGTHS = {
  source: 64,
  medium: 64,
  campaign: 96,
  content: 96,
  term: 96,
  landingPath: 200,
  referrerHost: 128,
} as const;

/** Everything outside this set is dropped: campaign identifiers are
 * lowercase slugs in practice, and stripping the rest keeps control
 * characters, quotes and HTML out of anything the admin panel renders. */
const DISALLOWED = /[^a-z0-9._~:/+-]/g;

/** Normalises one utm-style value into a storable slug, or null when there is
 * nothing left after cleaning. Exported for the test suite. */
export function normalizeCampaignValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase().replace(DISALLOWED, "").slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : null;
}

// Per-IP brake on the public write, same shape as the other public counters
// (ratings/feedback/contact): in-memory, resets on deploy, and generous
// enough that a real session — which writes at most once — never hits it.
const WRITE_WINDOW_MS = 10 * 60 * 1000;
const MAX_WRITES_PER_WINDOW = 20;
const writesByIp = new Map<string, { count: number; windowStart: number }>();

function withinWriteLimit(ip: string): boolean {
  const now = Date.now();
  const rec = writesByIp.get(ip);
  if (!rec || now - rec.windowStart > WRITE_WINDOW_MS) {
    writesByIp.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (rec.count >= MAX_WRITES_PER_WINDOW) return false;
  rec.count += 1;
  return true;
}

function readClientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Cloudflare sets this on every request that passes through its edge; it is
 * the only geo signal available without a lookup, and it is 2 letters. */
function readCountry(): string | null {
  try {
    const value = getRequestHeader("cf-ipcountry");
    return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export type CampaignVisitResult = { ok: boolean };

/** Records one campaign arrival. Always resolves — a failed write must never
 * surface as an error in the visitor's browser. */
export const recordCampaignVisit = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as {
      source?: unknown;
      medium?: unknown;
      campaign?: unknown;
      content?: unknown;
      term?: unknown;
      landingPath?: unknown;
      referrerHost?: unknown;
    };
    const source = normalizeCampaignValue(d?.source, MAX_LENGTHS.source);
    if (!source) throw new Error("Missing source");
    return {
      source,
      medium: normalizeCampaignValue(d?.medium, MAX_LENGTHS.medium),
      campaign: normalizeCampaignValue(d?.campaign, MAX_LENGTHS.campaign),
      content: normalizeCampaignValue(d?.content, MAX_LENGTHS.content),
      term: normalizeCampaignValue(d?.term, MAX_LENGTHS.term),
      landingPath: normalizeCampaignValue(d?.landingPath, MAX_LENGTHS.landingPath),
      referrerHost: normalizeCampaignValue(d?.referrerHost, MAX_LENGTHS.referrerHost),
    };
  })
  .handler(async ({ data }): Promise<CampaignVisitResult> => {
    if (!sql) return { ok: false };
    if (!withinWriteLimit(readClientIp())) return { ok: false };

    try {
      await sql.query(
        `INSERT INTO campaign_visits (source, medium, campaign, content, term, landing_path, referrer_host, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          data.source,
          data.medium,
          data.campaign,
          data.content,
          data.term,
          data.landingPath,
          data.referrerHost,
          readCountry(),
        ],
      );
      return { ok: true };
    } catch (error) {
      console.error("[campaign] failed to record visit", error);
      return { ok: false };
    }
  });
