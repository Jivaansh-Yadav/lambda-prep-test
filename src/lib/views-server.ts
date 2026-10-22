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

/** Increments the view counter for a file and returns the new count, used
 * when the Resource Watch pane loads a file. Always resolves (never
 * throws) so a DB hiccup never blocks the viewer from seeing the file. */
export const recordResourceView = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    return { fileId: d.fileId };
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
      return { count: row?.view_count ?? 0 };
    } catch (error) {
      console.error("[resource-views] failed to record view", error);
      return { count: 0 };
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
