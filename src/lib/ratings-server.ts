import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";
import { isKnownFileId } from "./resource-lookup-server";

// ---------------------------------------------------------------------
// Resource file ratings: students can rate a resource file 1-5 stars from
// its detail pane in the Resource Watch modal. Only files that have
// actually received at least one rating ever get a row here — there's no
// bulk-seeded "0 ratings" row per file, so the table only grows with real
// activity (table: resource_ratings in the same Neon database as the rest
// of the admin integrations, see db.ts).
//
// There's no sign-in system in this app, so "one vote per student" is
// approximated with a random per-browser voter id generated client-side
// and persisted in localStorage (see use-resource-rating.ts) — not a
// strong identity guarantee, but enough to let a student see/update their
// own rating and to prevent trivial accidental double-submits from the
// same browser.
//
// Abuse protection (GH issue #6): submitResourceRating previously accepted
// any client-supplied voterId + fileId with no throttling and no check
// that fileId was a real file, which made it trivial to script thousands
// of fake votes (brigading) or pollute the table with junk fileIds. Two
// mitigations, same shape as the other public write endpoints
// (feedback-server.ts, contact-server.ts, contribute-server.ts):
//   1. A light per-IP+voterId rate limit — not a hard security boundary
//      (in-memory, resets on deploy/restart, and a determined attacker can
//      rotate IPs), but it blunts naive scripted brigading from a single
//      source, which is the realistic threat here.
//   2. Reject any fileId that isn't found in the real resource dataset
//      (resolveFileLocation's index — the same data the public
//      Resources/Doxxmarks pages render from), so junk/made-up ids never
//      reach the table at all.
// ---------------------------------------------------------------------

const MAX_SUBMISSIONS = 10;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const submissionsByKey = new Map<string, { count: number; windowStart: number }>();

function getClientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const rec = submissionsByKey.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    submissionsByKey.set(key, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_SUBMISSIONS;
}

export type ResourceRatingSummary = {
  average: number | null;
  count: number;
  myRating: number | null;
};

async function fetchSummary(fileId: string, voterId: string | undefined): Promise<ResourceRatingSummary> {
  if (!sql) return { average: null, count: 0, myRating: null };

  const aggRows = await sql.query(
    `SELECT AVG(rating)::float AS average, COUNT(*)::int AS count FROM resource_ratings WHERE file_id = $1`,
    [fileId]
  );
  const agg = aggRows[0] as { average: number | null; count: number } | undefined;

  let myRating: number | null = null;
  if (voterId) {
    const mineRows = await sql.query(
      `SELECT rating FROM resource_ratings WHERE file_id = $1 AND voter_id = $2 LIMIT 1`,
      [fileId, voterId]
    );
    const mine = mineRows[0] as { rating: number } | undefined;
    myRating = mine?.rating ?? null;
  }

  return {
    average: agg?.average ?? null,
    count: agg?.count ?? 0,
    myRating,
  };
}

/** Fetches the aggregate rating (average + count) for a single resource
 * file, plus the current voter's own rating if a voterId is supplied. */
export const getResourceRating = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown; voterId?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    if (d.voterId !== undefined && typeof d.voterId !== "string") throw new Error("Invalid voterId");
    return { fileId: d.fileId, voterId: d.voterId as string | undefined };
  })
  .handler(async ({ data }): Promise<ResourceRatingSummary> => {
    return fetchSummary(data.fileId, data.voterId);
  });

/** Fetches aggregate ratings for a batch of file ids in one round trip —
 * used by the sidebar/file-grid views so each visible file can show its
 * rating without one request per card. Only returns rows for files that
 * actually have at least one rating; the caller treats a missing id as
 * "no ratings yet". */
export const getResourceRatingsBatch = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileIds?: unknown };
    if (!Array.isArray(d?.fileIds) || !d.fileIds.every((f) => typeof f === "string")) {
      throw new Error("Invalid fileIds");
    }
    return { fileIds: d.fileIds as string[] };
  })
  .handler(async ({ data }): Promise<Record<string, { average: number; count: number }>> => {
    if (!sql || data.fileIds.length === 0) return {};
    const rows = await sql.query(
      `SELECT file_id, AVG(rating)::float AS average, COUNT(*)::int AS count
       FROM resource_ratings WHERE file_id = ANY($1) GROUP BY file_id`,
      [data.fileIds]
    );
    const out: Record<string, { average: number; count: number }> = {};
    for (const row of rows as Array<{ file_id: string; average: number; count: number }>) {
      out[row.file_id] = { average: row.average, count: row.count };
    }
    return out;
  });

/** Upserts the current voter's 1-5 star rating for a file, then returns
 * the refreshed aggregate (so the UI can update in place without a
 * second round trip). Silently no-ops (returns the current aggregate
 * unchanged) when rate-limited or when fileId isn't a real resource,
 * rather than throwing — a dropped vote shouldn't surface as a visible
 * error to a well-behaved caller that's just unlucky with timing. */
export const submitResourceRating = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown; voterId?: unknown; rating?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    if (typeof d?.voterId !== "string" || !d.voterId) throw new Error("Missing voterId");
    if (typeof d?.rating !== "number" || !Number.isInteger(d.rating) || d.rating < 1 || d.rating > 5) {
      throw new Error("Rating must be an integer from 1 to 5");
    }
    return { fileId: d.fileId, voterId: d.voterId, rating: d.rating };
  })
  .handler(async ({ data }): Promise<ResourceRatingSummary> => {
    if (!sql) return { average: null, count: 0, myRating: null };

    if (isRateLimited(`${getClientIp()}:${data.voterId}`)) {
      return fetchSummary(data.fileId, data.voterId);
    }

    if (!(await isKnownFileId(data.fileId))) {
      return fetchSummary(data.fileId, data.voterId);
    }

    await sql.query(
      `INSERT INTO resource_ratings (file_id, voter_id, rating, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (file_id, voter_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = now()`,
      [data.fileId, data.voterId, data.rating]
    );

    return fetchSummary(data.fileId, data.voterId);
  });
