/**
 * Splits a lookback window into slices Cloudflare's RUM datasets report on
 * accurately.
 *
 * Why this exists: the `*AdaptiveGroups` datasets behind Web Analytics apply
 * adaptive sampling to a whole query, and the sample rate drops as the window
 * grows. Asking for one 30-day bucket series therefore returns *fewer* events
 * than the same days queried inside a 7-day window — measured against this
 * site's own data: the last 7 days reported 339 page loads across two days,
 * while the same two days inside a 30-day query reported 230 across one (the
 * quieter day vanished entirely). That reads as "the 30d panel is stale",
 * because it disagrees with the 7d panel for the overlapping days.
 *
 * Slicing the window into ≤7-day chunks and summing per bucket restores the
 * full-resolution numbers, so 7d, 14d and 30d agree on every day they share.
 */
export const RUM_CHUNK_MS = 7 * 24 * 60 * 60 * 1000;

export type RumWindow = { since: Date; until: Date };

/**
 * Oldest-first, non-overlapping slices covering `[startMs, endMs)` with a
 * maximum span of `chunkMs` (7 days by default). A window shorter than one
 * chunk yields exactly one slice, so 24h stays a single query.
 */
export function chunkWindows(startMs: number, endMs: number, chunkMs = RUM_CHUNK_MS): RumWindow[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  if (chunkMs <= 0) return [{ since: new Date(startMs), until: new Date(endMs) }];

  const windows: RumWindow[] = [];
  for (let cursor = endMs; cursor > startMs; cursor -= chunkMs) {
    windows.push({ since: new Date(Math.max(startMs, cursor - chunkMs)), until: new Date(cursor) });
  }
  return windows.reverse();
}
