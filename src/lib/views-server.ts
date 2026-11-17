import { createServerFn } from "@tanstack/react-start";
import { sql } from "./db";

// ---------------------------------------------------------------------
// Resource file views: a lean aggregate counter per file (table:
// resource_views), incremented once per Resource Watch pane load — not a
// per-event log, matching the existing resource_ratings/resource_feedback
// pattern of one small table per concern. There's no sign-in system in
// this app, so this is a simple "how many times was this file opened"
// counter, not a unique-visitor count; a viewer reloading the same file
// repeatedly increments it each time, same as a Drive view counter would.
// ---------------------------------------------------------------------

export type ResourceViewSummary = { count: number };

/** Calendar timezone for the "today" buckets behind the Trending section.
 * The audience is ICSE/ISC students in India, so a day has to roll over at
 * midnight IST rather than midnight UTC — a file watched at 1 AM IST would
 * otherwise still count towards the previous day. Postgres does the bucketing
 * (`now() AT TIME ZONE 'Asia/Kolkata'`), so the writes and the reads below can
 * never disagree about which day it is, no matter which instance served them. */
const TRENDING_TIMEZONE = "Asia/Kolkata";

export type TrendingFile = {
  fileId: string;
  name: string;
  subject: string;
  source: "cisce" | "community";
  views: number;
};

/** Increments the view counter for a file and returns the new count, used
 * when the Resource Watch pane loads a file. Always resolves (never
 * throws) so a DB hiccup never blocks the viewer from seeing the file. */
export const recordResourceView = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown; classSlug?: unknown; subject?: unknown; source?: unknown; name?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    // Optional provenance for the Trending section: the viewer knows which
    // class/subject it is showing, so it can hand that context over. Values
    // are length-capped here because they end up rendered on a public page.
    const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
    return {
      fileId: d.fileId,
      classSlug: text(d.classSlug, 40),
      subject: text(d.subject, 80),
      source: d.source === "cisce" || d.source === "community" ? d.source : null,
      name: text(d.name, 200),
    };
  })
  .handler(async ({ data }): Promise<ResourceViewSummary> => {
    if (!sql) return { count: 0 };
    try {
      const rows = await sql.query(
        `INSERT INTO resource_views (file_id, view_count, last_viewed_at)
         VALUES ($1, 1, now())
         ON CONFLICT (file_id) DO UPDATE SET view_count = resource_views.view_count + 1, last_viewed_at = now()
         RETURNING view_count`,
        [data.fileId]
      );
      const row = rows[0] as { view_count: number } | undefined;
      // Same view, second table: a per-day bucket that the Trending section
      // reads. Kept separate from the lifetime counter above so "top files
      // today" never has to scan a log, and so a day's ranking resets itself
      // without any scheduled job. The class/subject/source/name columns are
      // denormalised at write time — the viewer already knows them, and that
      // keeps the read path a single indexed query instead of resolving ids
      // against the whole resource catalog on every class page.
      await sql.query(
        `INSERT INTO resource_daily_views (file_id, day, view_count, class_slug, subject, source, file_name)
         VALUES ($1, (now() AT TIME ZONE $2)::date, 1, $3, $4, $5, $6)
         ON CONFLICT (file_id, day) DO UPDATE SET
           view_count = resource_daily_views.view_count + 1,
           class_slug = COALESCE(EXCLUDED.class_slug, resource_daily_views.class_slug),
           subject = COALESCE(EXCLUDED.subject, resource_daily_views.subject),
           source = COALESCE(EXCLUDED.source, resource_daily_views.source),
           file_name = COALESCE(EXCLUDED.file_name, resource_daily_views.file_name)`,
        [data.fileId, TRENDING_TIMEZONE, data.classSlug, data.subject, data.source, data.name]
      ).catch((error: unknown) => {
        // Trending is a nice-to-have; never let it break the view counter.
        console.error("[resource-views] failed to record daily view", error);
      });
      return { count: row?.view_count ?? 0 };
    } catch (error) {
      console.error("[resource-views] failed to record view", error);
      return { count: 0 };
    }
  });

/** Top files opened in one class today, most-viewed first.
 *
 * Returns an empty list when nothing in that class has been opened today —
 * callers use that to hide the Trending section entirely, so a class with no
 * traffic never shows an empty shell. Rows written before this feature (or
 * from a viewer that had no class context) simply don't participate: they
 * have no `class_slug`/`subject`, so they can neither be ranked for a class
 * nor deep-linked back into it. */
export const getTrendingFiles = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { classSlug?: unknown; limit?: unknown };
    if (typeof d?.classSlug !== "string" || !d.classSlug) throw new Error("Missing classSlug");
    const limit = typeof d.limit === "number" && Number.isFinite(d.limit) ? Math.min(Math.max(Math.trunc(d.limit), 1), 25) : 10;
    return { classSlug: d.classSlug, limit };
  })
  .handler(async ({ data }): Promise<{ files: TrendingFile[] }> => {
    if (!sql) return { files: [] };
    try {
      const rows = await sql.query(
        `SELECT file_id, file_name, subject, source, view_count
         FROM resource_daily_views
         WHERE day = (now() AT TIME ZONE $1)::date
           AND class_slug = $2
           AND subject IS NOT NULL
           AND source IS NOT NULL
         ORDER BY view_count DESC, file_name ASC
         LIMIT $3`,
        [TRENDING_TIMEZONE, data.classSlug, data.limit]
      );
      const files = (rows as Array<{ file_id: string; file_name: string | null; subject: string; source: string; view_count: number }>).map((row) => ({
        fileId: row.file_id,
        name: row.file_name ?? "Untitled file",
        subject: row.subject,
        source: row.source === "cisce" ? ("cisce" as const) : ("community" as const),
        views: row.view_count,
      }));
      return { files };
    } catch (error) {
      console.error("[resource-views] failed to load trending files", error);
      return { files: [] };
    }
  });


/** Fetches the current view count for a single file, without incrementing
 * it — used to show the count before any increment happens, if ever
 * needed separately from recordResourceView's own return value. */
export const getResourceViewCount = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    return { fileId: d.fileId };
  })
  .handler(async ({ data }): Promise<ResourceViewSummary> => {
    if (!sql) return { count: 0 };
    const rows = await sql.query(`SELECT view_count FROM resource_views WHERE file_id = $1`, [data.fileId]);
    const row = rows[0] as { view_count: number } | undefined;
    return { count: row?.view_count ?? 0 };
  });

/** Batch view-count lookup for a set of file ids, mirroring
 * getResourceRatingsBatch — used if file cards/sidebars ever want to show
 * view counts without one request per card. Missing ids simply have 0
 * views. */
export const getResourceViewsBatch = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileIds?: unknown };
    if (!Array.isArray(d?.fileIds) || !d.fileIds.every((f) => typeof f === "string")) {
      throw new Error("Invalid fileIds");
    }
    return { fileIds: d.fileIds as string[] };
  })
  .handler(async ({ data }): Promise<Record<string, number>> => {
    if (!sql || data.fileIds.length === 0) return {};
    const rows = await sql.query(
      `SELECT file_id, view_count FROM resource_views WHERE file_id = ANY($1)`,
      [data.fileIds]
    );
    const out: Record<string, number> = {};
    for (const row of rows as Array<{ file_id: string; view_count: number }>) {
      out[row.file_id] = row.view_count;
    }
    return out;
  });
