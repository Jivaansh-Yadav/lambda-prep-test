#!/usr/bin/env node
// STEP 2 (automated — runs weekly via GitHub Actions, no token needed):
// reads the committed insta-revision-sources.json (produced by
// discover-insta-revision-sources.mjs) and generates a fresh 7-day Google
// Cloud Storage signed URL for every chapter's Revision Notes PDF — the
// maximum expiry GCS allows. Writes insta-revision-links.json, which the
// app/consumers read to show always-fresh (if refreshed weekly) direct PDF
// links without ever downloading or re-hosting the files.
//
// Usage:
//   node generate-insta-revision-links.mjs
//     [--sources ../../src/data/insta-revision-sources.json]
//     [--out ../../src/data/insta-revision-links.json]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_BASE = "https://upload.extramarks.com";
const BASIC_AUTH = "Basic ZGViekAyMTIzMzpzMDBwZXJzM2NyZXQ=";
const MAX_EXPIRY_SECONDS = 604800; // GCS V4 signed URL hard limit: 7 days

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = {
    sources: path.resolve(SCRIPT_DIR, "../../src/data/insta-revision-sources.json"),
    out: path.resolve(SCRIPT_DIR, "../../src/data/insta-revision-links.json"),
    concurrency: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--sources") args.sources = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--out") args.out = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]);
  }
  return args;
}

async function getSignedUrl(folderPath, expirySeconds, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const form = new FormData();
    form.append("folderPath", folderPath);
    form.append("bucketName", "gs://em_content_private");
    form.append("expiry", String(expirySeconds));
    const res = await fetch(`${UPLOAD_BASE}/getSignedUrl`, {
      method: "POST",
      headers: { Authorization: BASIC_AUTH },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.url) return json.url;
      if (attempt === retries) throw new Error(`getSignedUrl returned no url for ${folderPath}`);
    } else if (attempt === retries) {
      throw new Error(`getSignedUrl HTTP ${res.status} for ${folderPath}`);
    }
    await sleep(Math.min(500 * 2 ** attempt, 8000));
  }
  throw new Error(`getSignedUrl exhausted retries for ${folderPath}`);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = JSON.parse(await fs.readFile(args.sources, "utf8"));

  const manifest = {
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + MAX_EXPIRY_SECONDS * 1000).toISOString(),
    sourcesGeneratedAt: sources.generatedAt ?? null,
    classes: {},
  };
  const failed = [];
  let linkCount = 0;

  for (const [classLabel, subjects] of Object.entries(sources.classes ?? {})) {
    console.log(`\n=== ${classLabel} ===`);
    manifest.classes[classLabel] = {};

    for (const [subjectName, chapters] of Object.entries(subjects)) {
      const chapterEntries = Object.entries(chapters);
      const subjectLinks = {};

      await mapLimit(chapterEntries, args.concurrency, async ([chapterName, notes]) => {
        const links = [];
        for (const note of notes) {
          try {
            const signedUrl = await getSignedUrl(note.folderPath, MAX_EXPIRY_SECONDS);
            links.push({ name: note.title || chapterName, link: signedUrl });
            linkCount += 1;
          } catch (err) {
            failed.push({ classLabel, subject: subjectName, chapter: chapterName, error: err.message });
          }
        }
        if (links.length) subjectLinks[chapterName] = links;
      });

      if (Object.keys(subjectLinks).length) {
        manifest.classes[classLabel][subjectName] = subjectLinks;
        console.log(`  Subject: ${subjectName} (${Object.keys(subjectLinks).length} chapters)`);
      }
    }
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(manifest, null, 2));

  console.log("\n=== Summary ===");
  console.log(`Signed links generated: ${linkCount}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Manifest written to: ${args.out}`);
  if (failed.length) {
    console.log("Failures:", JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
