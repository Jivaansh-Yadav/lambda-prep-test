#!/usr/bin/env node
// STEP 3 (automated — runs weekly via GitHub Actions right after
// generate-insta-revision-links.mjs): merges the freshly-generated
// insta-revision-links.json (direct, signed GCS PDF URLs, valid 7 days)
// into src/data/curriculum.json's chapter-level `revisionNotes` field.
//
// Matching key: (board, class roman, subject name, normalized chapter name).
// insta-revision-sources.json classLabels look like "ICSE - X" / "ISC - XI".
//
// Usage:
//   node apply-insta-revision-links.mjs
//     [--links ../../src/data/insta-revision-links.json]
//     [--curriculum ../../src/data/curriculum.json]

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const CLASS_LABEL_TO_BOARD_ROMAN = {
  "icse - ix": ["ICSE", "IX"],
  "icse - x": ["ICSE", "X"],
  "isc - xi": ["ISC", "XI"],
  "isc - xii": ["ISC", "XII"],
};

function parseArgs(argv) {
  const args = {
    links: path.resolve(SCRIPT_DIR, "../../src/data/insta-revision-links.json"),
    curriculum: path.resolve(SCRIPT_DIR, "../../src/data/curriculum.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--links") args.links = path.resolve(process.cwd(), argv[++i]);
    else if (argv[i] === "--curriculum") args.curriculum = path.resolve(process.cwd(), argv[++i]);
  }
  return args;
}

/** Loosely normalize a chapter name for fuzzy matching against Extramarks
 * titles, which don't always agree with the curriculum's chapter name on
 * singular/plural or punctuation (e.g. "Refraction of Light at Plane
 * Surface" vs "...Plane Surfaces"). Lowercases, strips punctuation,
 * collapses whitespace, and strips a single trailing 's' from each word
 * (crude singularization) so minor singular/plural drift still matches. */
function normalizeChapterKey(name) {
  const words = (name.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const singularized = words.map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return singularized.join(" ");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const links = JSON.parse(await fs.readFile(args.links, "utf8"));
  const curriculum = JSON.parse(await fs.readFile(args.curriculum, "utf8"));

  // (board, roman, subjectName, normalizedChapterKey) -> [{name, link}]
  const notesByKey = new Map();
  for (const [classLabel, subjects] of Object.entries(links.classes ?? {})) {
    const boardRoman = CLASS_LABEL_TO_BOARD_ROMAN[classLabel.trim().toLowerCase()];
    if (!boardRoman) continue;
    const [board, roman] = boardRoman;
    for (const [subjectName, chapters] of Object.entries(subjects)) {
      for (const [chapterName, notes] of Object.entries(chapters)) {
        const key = `${board}|${roman}|${subjectName.trim()}|${normalizeChapterKey(chapterName)}`;
        const existing = notesByKey.get(key) ?? [];
        notesByKey.set(key, existing.concat(notes));
      }
    }
  }

  let updated = 0;
  for (const [board, boardData] of Object.entries(curriculum.boards ?? {})) {
    for (const [roman, classData] of Object.entries(boardData.classes ?? {})) {
      for (const subject of classData.subjects ?? []) {
        for (const chapter of subject.chapters ?? []) {
          const key = `${board}|${roman}|${(subject.name ?? "").trim()}|${normalizeChapterKey(chapter.name ?? "")}`;
          const notes = notesByKey.get(key);
          if (notes && notes.length) {
            chapter.revisionNotes = notes;
            updated += 1;
          }
        }
      }
    }
  }

  // Pretty-printed (3-space indent) to match the hand-formatted style the
  // file was last saved in -- keeps future diffs readable instead of
  // collapsing back to one compact line.
  await fs.writeFile(args.curriculum, JSON.stringify(curriculum, null, 3));
  console.log(`Updated revisionNotes for ${updated} chapter(s) in ${args.curriculum}`);
  if (!updated) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
