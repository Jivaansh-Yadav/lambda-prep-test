// db.mjs
//
// Thin wrapper around `pg` for writing to the analytics_history table on
// Neon. Uses a plain TCP Postgres client (not @neondatabase/serverless),
// since this script runs as a standalone long-lived/one-shot process, not
// in an edge/serverless request handler.

import { Client } from "pg";

/**
 * Thrown for any database-side failure (connection, auth, query) so
 * callers can catch a single error type and distinguish it from
 * Cloudflare-side failures.
 */
export class DatabaseError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "DatabaseError";
    this.cause = cause;
  }
}

/**
 * Upserts a single day's zone-wide totals into analytics_history.
 * `page_path` is always 'ALL', representing the whole zone rather than a
 * per-page breakdown. Re-running for a date that's already stored
 * overwrites that row via ON CONFLICT, so backfills/retries are safe.
 */
export async function upsertDailyTotal({ connectionString, date, pageviews, uniques }) {
  if (!connectionString) {
    throw new DatabaseError("Missing DATABASE_URL.");
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
  } catch (error) {
    throw new DatabaseError(
      `Could not connect to Neon: ${error.message}`,
      error
    );
  }

  try {
    await client.query(
      `INSERT INTO analytics_history (date, page_path, pageviews, uniques)
       VALUES ($1, 'ALL', $2, $3)
       ON CONFLICT (date, page_path)
       DO UPDATE SET pageviews = EXCLUDED.pageviews, uniques = EXCLUDED.uniques`,
      [date, pageviews, uniques]
    );
  } catch (error) {
    throw new DatabaseError(
      `Failed to upsert analytics_history row for ${date}: [${error.code ?? "?"}] ${error.message}`,
      error
    );
  } finally {
    await client.end().catch(() => {
      // Ignore errors closing an already-broken connection.
    });
  }
}
