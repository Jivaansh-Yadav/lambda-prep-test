#!/usr/bin/env node
// Writes scripts/drive-crawl/service-account.json for the Drive crawl.
//
// The service-account key is not a repository secret of its own: it lives in
// Neon (`drive_integration.service_account_json`), which is where the running
// app reads it from too. Keeping one copy means a rotated key cannot leave the
// weekly crawl authenticating with a stale one — the failure mode that looks
// like "Permission denied on the service".
//
// Credential sources, in order:
//   1. DATABASE_URL (or NEON_DATABASE_URL) -> query Neon (see neon-config.mjs).
//   2. SERVICE_ACCOUNT -> raw key JSON, kept as a fallback for a runner that
//      has no database access.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/drive-crawl/fetch-credentials.mjs
//   SERVICE_ACCOUNT="$(cat key.json)" node scripts/drive-crawl/fetch-credentials.mjs
//
// Never prints key material; prints only the client_email it will crawl as.

import fs from "node:fs";
import path from "node:path";

import { databaseUrl, getDriveServiceAccount } from "./neon-config.mjs";

const OUT = path.resolve(process.cwd(), "scripts/drive-crawl/service-account.json");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function validate(key, source) {
  if (!key || typeof key !== "object") fail(`${source} did not yield a key object.`);
  const missing = ["client_email", "private_key"].filter((field) => !key[field]);
  if (missing.length) {
    fail(`${source} is missing ${missing.join(", ")}. Expected the service-account key JSON.`);
  }
  return key;
}

async function main() {
  const connectionString = databaseUrl();
  const inlineKey = process.env.SERVICE_ACCOUNT || "";

  let key;
  let source;
  if (connectionString) {
    key = await getDriveServiceAccount();
    source = "Neon drive_integration";
  } else if (inlineKey.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(inlineKey);
    } catch {
      fail("SERVICE_ACCOUNT is set but is not valid JSON.");
    }
    key = validate(parsed, "SERVICE_ACCOUNT");
    source = "SERVICE_ACCOUNT env";
  } else {
    fail(
      "No credentials. Set DATABASE_URL (preferred — the key is read from Neon's " +
        "drive_integration row) or SERVICE_ACCOUNT with the raw key JSON.",
    );
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(key), { mode: 0o600 });
  console.log(`Crawling as ${key.client_email} (credentials from ${source})`);
}

main().catch((err) => fail(err.message));
