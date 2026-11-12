#!/usr/bin/env node
// STEP 1 (manual / occasional — run whenever Extramarks content might have
// changed, not every week): crawls every subject/chapter across ICSE IX/X
// and ISC XI/XII and records the GCS folderPath + title for each chapter's
// "Revision Notes" (InstaRevision) PDF. This needs a short-lived
// EXTRAMARKS_TOKEN (teacher login JWT, ~60min) read from the Extramarks
// teacher app's localStorage: JSON.parse(localStorage.extramarks_user)
// .access_token. Background: wiki/Doxxmarks-and-Signed-Links.md.
//
// The output (insta-revision-sources.json) has NO expiry — folder paths in
// GCS don't change — so it's committed to the repo and only needs
// regenerating when new chapters/subjects are added on Extramarks. The
// separate generate-insta-revision-links.mjs script turns this into actual
// signed URLs every week using only a static credential (no token needed),
// and is what the GitHub Action runs.
//
// Usage:
//   EXTRAMARKS_TOKEN=... node discover-insta-revision-sources.mjs [--out ../../src/data/insta-revision-sources.json]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = "https://apigateway.extramarks.com";
const BOARD_ID = 404;
const LANGUAGE_ID = 1;

const CLASSES = [
  { board: "ICSE", className: "IX", classId: 19727273 },
  { board: "ICSE", className: "X", classId: 19727898 },
  { board: "ISC", className: "XI", classId: 19728524 },
  { board: "ISC", className: "XII", classId: 19729330 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { out: path.resolve(SCRIPT_DIR, "../../src/data/insta-revision-sources.json"), concurrency: 4 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") args.out = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--concurrency") args.concurrency = Number(argv[++i]);
  }
  return args;
}

function childListUrl(boardId, syllabusId, languageId) {
  const url = new URL("/syllabus-v2/childList/v2.1.1", API_BASE);
  url.search = new URLSearchParams({ boardId, syllabusId, languageId }).toString();
  return url.href;
}

function syllabusDataUrl(boardId, classId, syllabusId, languageId) {
  const url = new URL("/arjuna/syllabusData/v2.3.4", API_BASE);
  url.search = new URLSearchParams({
    boardId: String(boardId),
    classId: String(classId),
    syllabusId: String(syllabusId),
    aggregatorMode: "1",
    userType: "teacher",
    languageId: String(languageId),
  }).toString();
  return url.href;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, token, Accept: "application/json" };
}

async function fetchJsonWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function getChildList(boardId, syllabusId, languageId, headers) {
  const response = await fetchJsonWithRetry(childListUrl(boardId, syllabusId, languageId), { headers });
  return response.data?.child_list ?? [];
}

async function getRevisionNotesForChapter({ boardId, classId, chapterSyllabusId, languageId, headers }) {
  const data = await fetchJsonWithRetry(syllabusDataUrl(boardId, classId, chapterSyllabusId, languageId), {
    headers,
  });
  const found = [];
  for (const group of data.data?.group_list ?? []) {
    for (const content of group.content_data ?? []) {
      const tags = Object.fromEntries((content.tag_data ?? []).map((t) => [t.tagName, t.tagValue]));
      if (tags["Content Type"] === "PDF" && tags["Content Group"] === "Revision Notes") {
        found.push({ title: content.content_title ?? "", folderPath: content.content_url ?? "" });
      }
    }
  }
  return found;
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
  const token = process.env.EXTRAMARKS_TOKEN;
  if (!token) throw new Error("Set EXTRAMARKS_TOKEN env var");
  const headers = authHeaders(token);

  const manifest = { generatedAt: new Date().toISOString(), classes: {} };
  const failed = [];
  let sourceCount = 0;

  for (const cls of CLASSES) {
    const classLabel = `${cls.board} - ${cls.className}`;
    console.log(`\n=== ${classLabel} ===`);
    manifest.classes[classLabel] = {};

    const subjects = await getChildList(BOARD_ID, cls.classId, LANGUAGE_ID, headers);
    for (const subject of subjects) {
      console.log(`  Subject: ${subject.name}`);
      let chapters;
      try {
        chapters = await getChildList(BOARD_ID, subject.syllabus_id, LANGUAGE_ID, headers);
      } catch (err) {
        console.log(`    ! Failed to list chapters: ${err.message}`);
        continue;
      }

      const subjectSources = {};

      await mapLimit(chapters, args.concurrency, async (chapter) => {
        let notes;
        try {
          notes = await getRevisionNotesForChapter({
            boardId: BOARD_ID,
            classId: cls.classId,
            chapterSyllabusId: chapter.syllabus_id,
            languageId: LANGUAGE_ID,
            headers,
          });
        } catch (err) {
          failed.push({ classLabel, subject: subject.name, chapter: chapter.name, error: err.message });
          return;
        }
        if (notes.length === 0) return;
        subjectSources[chapter.name] = notes;
        sourceCount += notes.length;
        console.log(`    ✓ ${chapter.name}`);
      });

      if (Object.keys(subjectSources).length) {
        manifest.classes[classLabel][subject.name] = subjectSources;
      }
      await sleep(100);
    }
  }

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, JSON.stringify(manifest, null, 2));

  console.log("\n=== Summary ===");
  console.log(`Sources recorded: ${sourceCount}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Manifest written to: ${args.out}`);
  if (failed.length) console.log("Failures:", JSON.stringify(failed, null, 2));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
