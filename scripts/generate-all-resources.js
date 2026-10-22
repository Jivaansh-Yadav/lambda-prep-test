#!/usr/bin/env node
/**
 * One-shot pipeline: re-crawl Google Drive, rebuild every resource dataset
 * for all four classes (icse-9, icse-10, isc-11, isc-12) across both
 * sources (CISCE + Community), re-shard any dataset that's grown too large
 * to load monolithically, normalize subject card order, and regenerate the
 * resource-count summary — all in a single `node generate-all-resources.js`
 * run instead of manually chaining the individual scripts in order.
 *
 * Steps:
 *   1. scripts/drive-crawl/generate-drive-json.js -> scripts/drive-crawl/output/
 *      <class>/{cisce,community}.json for each of icse-9, icse-10, isc-11,
 *      isc-12, plus output/doxxmarks.json (crawls the single unified Lambda
 *      Prep Drive root; has its own exponential-backoff retries)
 *   2. scripts/transform-resources.py        -> src/data/resources-{cisce,
 *                                               community}-<class>.json for
 *                                               every class with crawl
 *                                               output present, and rewrites
 *                                               src/data/curriculum.json's
 *                                               chapter revisionNotes from
 *                                               Doxxmarks InstaRevision PDFs
 *   3. scripts/split-resources-dataset.py    -> shards any resources-*.json
 *                                               dataset that's grown past
 *                                               the size threshold into
 *                                               resources-<source>-<class>/*.json
 *   4. scripts/sort-manifest-subjects.py     -> reorders every manifest.json's
 *                                               subjects: Featured first, then A-Z
 *   5. scripts/count-resources.py            -> src/data/resource-counts.json
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

  // Step 2: transform every class's CISCE + Community datasets, and update
  // curriculum.json's chapter revisionNotes from Doxxmarks.
  steps.push({
    label: "Transform CISCE + Community resources for all classes",
    run: () => run("python3", ["scripts/transform-resources.py"], PROJECT_ROOT),
  });

  // Step 3: shard any dataset that's grown past the split threshold.
  steps.push({
    label: "Split oversized datasets per subject",
    run: () => run("python3", ["scripts/split-resources-dataset.py"], PROJECT_ROOT),
  });

  // Step 4: sort each dataset's manifest subject order — "Featured" first,
  // then alphabetical (Miscellaneous is appended last by the UI itself via
  // miscCount, so it needs no entry here).
  steps.push({
    label: "Sort manifest subject order (Featured first, then A-Z)",
    run: () => run("python3", ["scripts/sort-manifest-subjects.py"], PROJECT_ROOT),
  });

  // Step 5: recompute resource counts across every dataset.
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
