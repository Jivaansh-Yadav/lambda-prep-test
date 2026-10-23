// cloudflare-integration-server.ts
//
// Server-only Cloudflare Web Analytics (RUM) credentials reader for the
// admin "Deep analytics" panel. Reads the account ID + RUM API token +
// site tag from Neon (table: cloudflare_integration) rather than the
// server environment, mirroring the drive_integration/github_integration
// pattern in drive-integration-server.ts / github-integration-server.ts.

import { sql } from "./db";

export type CloudflareIntegrationConfig = {
  accountId: string;
  rumApiToken: string;
  rumSiteTag: string;
};

/**
 * Reads the single-row Cloudflare integration config (account ID + RUM
 * API token + site tag) from Neon. Returns null if the row doesn't exist
 * yet, or if `sql` isn't configured (no DATABASE_URL) — callers should
 * treat that the same as "not configured".
 */
export async function getCloudflareIntegrationConfig(): Promise<CloudflareIntegrationConfig | null> {
  if (!sql) return null;
  const rows = await sql.query(
    "SELECT account_id, rum_api_token, rum_site_tag FROM cloudflare_integration WHERE id = true LIMIT 1"
  );
  const row = rows[0] as { account_id: string; rum_api_token: string; rum_site_tag: string } | undefined;
  if (!row) return null;
  return { accountId: row.account_id, rumApiToken: row.rum_api_token, rumSiteTag: row.rum_site_tag };
}
