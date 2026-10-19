// index.mjs
//
// Daily cron entrypoint: fetches *yesterday's* Cloudflare zone-wide totals
// and upserts them into analytics_history on Neon.
//
// Usage:
//   node index.mjs            run the node-cron scheduler, fires at 00:00 daily
//   node index.mjs --once     run a single sync immediately and exit
//   node index.mjs --once --date=2026-10-18   backfill a specific date

import "dotenv/config";
import cron from "node-cron";
import { fetchDailyTotals, CloudflareFetchError } from "./cloudflare.mjs";
import { upsertDailyTotal, DatabaseError } from "./db.mjs";

/** Returns YYYY-MM-DD for "yesterday" in UTC. */
function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Runs one sync for `dateStr` (defaults to yesterday, UTC). Never throws:
 * logs and returns a boolean so both the scheduler and --once mode can
 * decide what to do next without crashing the process.
 */
async function runSync(dateStr = yesterdayUTC()) {
  const startedAt = new Date().toISOString();
  console.log(`[analytics-cron] ${startedAt} starting sync for ${dateStr}`);

  let totals;
  try {
    totals = await fetchDailyTotals({
      zoneId: process.env.CLOUDFLARE_ZONE_ID,
      apiToken: process.env.CLOUDFLARE_API_TOKEN,
      dateStr,
    });
  } catch (error) {
    if (error instanceof CloudflareFetchError) {
      console.error(`[analytics-cron] Cloudflare fetch failed for ${dateStr}: ${error.message}`);
    } else {
      console.error(`[analytics-cron] Unexpected error fetching Cloudflare data for ${dateStr}:`, error);
    }
    return false;
  }

  try {
    await upsertDailyTotal({
      connectionString: process.env.DATABASE_URL,
      date: totals.date,
      pageviews: totals.pageviews,
      uniques: totals.uniques,
    });
  } catch (error) {
    if (error instanceof DatabaseError) {
      console.error(`[analytics-cron] DB upsert failed for ${dateStr}: ${error.message}`);
    } else {
      console.error(`[analytics-cron] Unexpected error upserting to Neon for ${dateStr}:`, error);
    }
    return false;
  }

  console.log(
    `[analytics-cron] stored ${dateStr}: pageviews=${totals.pageviews} uniques=${totals.uniques}`
  );
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes("--once");
  const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];

  if (once) {
    const ok = await runSync(dateArg);
    process.exit(ok ? 0 : 1);
  }

  // Long-lived scheduler mode: fire once at 00:00 server time, every day.
  console.log("[analytics-cron] scheduler started, will run daily at 00:00");
  cron.schedule("0 0 * * *", () => {
    runSync().catch((error) => {
      // runSync already catches its own errors; this is a last-resort net
      // so a scheduler tick can never kill the process.
      console.error("[analytics-cron] unexpected top-level error:", error);
    });
  });
}

main().catch((error) => {
  console.error("[analytics-cron] fatal startup error:", error);
  process.exit(1);
});
