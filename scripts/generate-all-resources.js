#!/usr/bin/env node
/**
 * One-shot pipeline: re-crawl Google Drive, rebuild every resource dataset,
 * re-shard the large community dataset per subject, normalize subject card
 * order, and regenerate the resource-count summary — all in a single
 * `node generate-all-resources.js` run instead of manually chaining the
 * individual scripts in order.
 *
 * Steps:
 *   1. scripts/drive-crawl/generate-drive-json.js -> scripts/drive-crawl/output/*.json
 *      (crawls Google Drive; has its own 50ms exponential-backoff retries)
 *   2. scripts/transform-resources.py        -> src/data/resources-cisce-icse-10.json
 *                                               src/data/resources-community-icse-10.json
 *   3. scripts/transform-isc11-resources.py  -> src/data/resources-community-isc-11.json
 *      (only if its expected ISC11_SRC_DIR source files are present — this
 *      step is skipped otherwise, since ISC-11 source dumps are a manual
 *      one-off upload, not part of the regular Drive crawl)
 *   4. scripts/split-resources-dataset.py    -> shards resources-community-icse-10.json
 *                                               into resources-community-icse-10/*.json
 *   5. scripts/sort-manifest-subjects.py     -> reorders every manifest.json's
 *                                               subjects: Featured first, then A-Z
 *   6. scripts/count-resources.py            -> src/data/resource-counts.json
 *
 * Any step failing aborts the run (fail-fast) so a half-updated dataset
 * never silently ships.
 *
 * Usage:
 *   node scripts/generate-all-resources.js
 *   node scripts/generate-all-resources.js --skip-crawl   # reuse the last
 *                                                           # Drive crawl's
 *                                                           # output/*.json
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DRIVE_CRAWL_DIR = path.join(PROJECT_ROOT, "scripts", "drive-crawl");

function run(command, args, cwd, { timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
    const child = spawn(command, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
    let timer;
    if (timeoutMs) {
      timer = setTimeout(() => {
        console.error(`⏱ Timed out after ${timeoutMs}ms, killing process.`);
        child.kill("SIGKILL");
      }, timeoutMs);
    }
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  const skipCrawl = process.argv.includes("--skip-crawl");
  const steps = [];

  // Step 1: crawl Google Drive (only if the crawl project + credentials are
  // actually set up here — this repo doesn't ship service-account.json by
  // default, so this step is best-effort and skipped with a warning if
  // missing, or via the explicit --skip-crawl flag when reusing the last
  // crawl's output). In CI, the workflow writes service-account.json from a
  // secret before invoking this script, and installs
  // scripts/drive-crawl/node_modules via its own package.json.
  const hasDriveCrawl =
    !skipCrawl &&
    fs.existsSync(path.join(DRIVE_CRAWL_DIR, "generate-drive-json.js")) &&
    fs.existsSync(path.join(DRIVE_CRAWL_DIR, "service-account.json"));

  if (hasDriveCrawl) {
    steps.push({
      label: "Crawl Google Drive",
      // Drive crawls over a full folder tree can legitimately take minutes,
      // but a hung network call (no connectivity, bad credentials, etc.)
      // should still fail the pipeline instead of blocking forever.
      run: () => run("node", ["generate-drive-json.js"], DRIVE_CRAWL_DIR, { timeoutMs: 10 * 60 * 1000 }),
    });
  } else {
    console.warn(
      skipCrawl
        ? "⚠️ Skipping Drive crawl — --skip-crawl was passed. Using whatever is already in scripts/drive-crawl/output/."
        : "⚠️ Skipping Drive crawl — scripts/drive-crawl/service-account.json not found. " +
            "Using whatever is already in scripts/drive-crawl/output/."
    );
  }

  // Step 2: CISCE + Community (ICSE-10) transform.
  steps.push({
    label: "Transform CISCE + Community ICSE-10 resources",
    run: () => run("python3", ["scripts/transform-resources.py"], PROJECT_ROOT),
  });

  // Step 3: ISC-11 transform (optional — depends on a manual upload).
  const isc11SrcDir = process.env.ISC11_SRC_DIR || "/tmp/clacky-uploads";
  const isc11Sources = [
    "20bc943212a30034_chemistry.json",
    "9a8dfba8ba64f4c2_english.json",
    "0ac513c2cc0b0021_maths.json",
    "a3576d60003ef70d_physics.json",
  ].map((f) => path.join(isc11SrcDir, f));
  const hasIsc11Sources = isc11Sources.every((p) => fs.existsSync(p));

  if (hasIsc11Sources) {
    steps.push({
      label: "Transform ISC-11 community resources",
      run: () => run("python3", ["scripts/transform-isc11-resources.py"], PROJECT_ROOT, { env: { ISC11_SRC_DIR: isc11SrcDir } }),
    });
  } else {
    console.warn(
      `⚠️ Skipping ISC-11 transform — source dumps not found in ${isc11SrcDir}. ` +
        "Keeping the existing src/data/resources-community-isc-11.json as-is."
    );
  }

  // Step 4: shard the large Community ICSE-10 dataset per subject.
  steps.push({
    label: "Split Community ICSE-10 dataset per subject",
    run: () => run("python3", ["scripts/split-resources-dataset.py"], PROJECT_ROOT),
  });

  // Step 5: sort each dataset's manifest subject order — "Featured" first,
  // then alphabetical (Miscellaneous is appended last by the UI itself via
  // miscCount, so it needs no entry here).
  steps.push({
    label: "Sort manifest subject order (Featured first, then A-Z)",
    run: () => run("python3", ["scripts/sort-manifest-subjects.py"], PROJECT_ROOT),
  });

  // Step 6: recompute resource counts across every dataset.
  steps.push({
    label: "Count resources across all datasets",
    run: () => run("python3", ["scripts/count-resources.py"], PROJECT_ROOT),
  });

  for (const step of steps) {
    console.log(`\n=== ${step.label} ===`);
    await step.run();
  }

  console.log("\n✅ All resource datasets regenerated.");
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message);
  process.exit(1);
});
