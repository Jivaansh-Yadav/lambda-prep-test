// cloudflare.mjs
//
// Fetches zone-wide totals (page views, unique visitors) for a single day
// from Cloudflare's GraphQL Analytics API.

import fetch from "node-fetch";

const CLOUDFLARE_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

const DAILY_TOTALS_QUERY = `
  query GetDailyTotals($zoneTag: String!, $date: Date!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        httpRequests1dGroups(
          limit: 1,
          filter: { date: $date }
        ) {
          sum {
            pageViews
          }
          uniq {
            uniques
          }
        }
      }
    }
  }
`;

/**
 * Thrown for any Cloudflare-side failure (network, HTTP status, GraphQL
 * error, or missing data) so callers can catch a single error type.
 */
export class CloudflareFetchError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "CloudflareFetchError";
    this.cause = cause;
  }
}

/**
 * Fetches zone-wide pageviews + unique visitors for `dateStr`
 * (YYYY-MM-DD, UTC) from Cloudflare. Throws CloudflareFetchError on any
 * failure instead of returning a partial/zeroed result, so the caller can
 * decide whether to skip the day rather than silently writing zeros.
 */
export async function fetchDailyTotals({ zoneId, apiToken, dateStr }) {
  if (!zoneId || !apiToken) {
    throw new CloudflareFetchError(
      "Missing CLOUDFLARE_ZONE_ID or CLOUDFLARE_API_TOKEN."
    );
  }

  let response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: DAILY_TOTALS_QUERY,
        variables: { zoneTag: zoneId, date: dateStr },
      }),
    });
  } catch (error) {
    throw new CloudflareFetchError(
      `Network error reaching Cloudflare's API: ${error.message}`,
      error
    );
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "<unreadable>");
    throw new CloudflareFetchError(
      `Cloudflare API returned HTTP ${response.status}: ${bodyText.slice(0, 300)}`
    );
  }

  const json = await response.json();

  if (json.errors?.length) {
    throw new CloudflareFetchError(
      `Cloudflare GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }

  const group = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups?.[0];
  if (!group) {
    throw new CloudflareFetchError(
      `Cloudflare returned no data for ${dateStr} (zone may have had zero traffic, or zoneId is wrong).`
    );
  }

  return {
    date: dateStr,
    pageviews: group.sum?.pageViews ?? 0,
    uniques: group.uniq?.uniques ?? 0,
  };
}
