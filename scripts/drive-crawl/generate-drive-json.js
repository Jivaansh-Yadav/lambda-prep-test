import fs from "fs";
import path from "path";
import { google } from "googleapis";

// 🔐 Auth
const auth = new google.auth.GoogleAuth({
  keyFile: "service-account.json",
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

const FIELDS = "id, name, mimeType, createdTime, modifiedTime, size, shortcutDetails";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 🔁 Retry wrapper: every Drive API call goes through this so transient
// errors (rate limits, network blips, 5xx) get retried instead of aborting
// the whole crawl. Delay starts at 50ms and doubles each attempt
// (50ms, 100ms, 200ms, 400ms, ...), capped at MAX_DELAY_MS, up to
// MAX_RETRIES attempts before giving up and rethrowing.
const BASE_DELAY_MS = 50;
const MAX_DELAY_MS = 10_000;
const MAX_RETRIES = 6;

async function withRetry(fn, label = "request") {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > MAX_RETRIES) {
        console.error(`❌ ${label} failed after ${MAX_RETRIES} retries:`, err.message);
        throw err;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      console.warn(`⚠️ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.message} — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
}

// 🔁 Prevent duplicates (for shortcuts)
const seen = new Set();

// 🔁 Recursive crawl
async function getFolder(folderId, currentPath = "") {
  let files = [];
  let pageToken = null;

  do {
    const res = await withRetry(
      () =>
        drive.files.list({
          q: `'${folderId}' in parents and trashed=false`,
          fields: `nextPageToken, files(${FIELDS})`,
          pageToken,
          pageSize: 1000,
        }),
      `files.list(${folderId})`
    );

    files = files.concat(res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  const children = [];

  for (const file of files) {
    // 🔥 HANDLE SHORTCUT
    if (file.mimeType === "application/vnd.google-apps.shortcut") {
      const targetId = file.shortcutDetails?.targetId;
      const targetMime = file.shortcutDetails?.targetMimeType;

      if (!targetId) continue;

      // 📂 Shortcut → Folder
      if (targetMime === "application/vnd.google-apps.folder") {
        const newPath = currentPath
          ? `${currentPath} / ${file.name}`
          : file.name;

        children.push({
          name: file.name,
          type: "folder",
          children: await getFolder(targetId, newPath),
        });
      }

      // 📄 Shortcut → File
      else {
        if (seen.has(targetId)) continue;
        seen.add(targetId);

        const meta = await withRetry(
          () =>
            drive.files.get({
              fileId: targetId,
              fields: FIELDS,
            }),
          `files.get(${targetId})`
        );

        children.push({
          name: meta.data.name,
          type: "file",
          id: targetId,
          mimeType: meta.data.mimeType,
          createdTime: meta.data.createdTime,
          modifiedTime: meta.data.modifiedTime,
          size: meta.data.size ?? null,
          path: currentPath,
        });
      }

      continue;
    }

    // 📂 Normal folder
    if (file.mimeType === "application/vnd.google-apps.folder") {
      const newPath = currentPath
        ? `${currentPath} / ${file.name}`
        : file.name;

      children.push({
        name: file.name,
        type: "folder",
        children: await getFolder(file.id, newPath),
      });
    }

    // 📄 Normal file
    else {
      if (seen.has(file.id)) continue;
      seen.add(file.id);

      children.push({
        name: file.name,
        type: "file",
        id: file.id,
        mimeType: file.mimeType,
        createdTime: file.createdTime,
        modifiedTime: file.modifiedTime,
        size: file.size ?? null,
        path: currentPath,
      });
    }
  }

  // sort folders first
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return children;
}

// 🏁 Main: crawl the unified Lambda Prep Drive root. Its direct children are
// one folder per class ("ICSE - IX", "ICSE - X", "ISC - XI", "ISC - XII")
// plus a "Doxxmarks" folder (InstaRevision chapter notes, nested the same
// way: Doxxmarks / <class folder name> / <subject> / <chapter> -
// InstaRevision.pdf). Each class folder contains "CISCE Resources" (board
// publications: APF/CFQ/PYQP/SQP/Syllabus type-folders) and
// "Community Resources" (subject-named folders directly).
const NEW_ROOT_FOLDER_ID = "1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc";

const CLASS_FOLDER_TO_SLUG = {
  "icse - ix": "icse-9",
  "icse - x": "icse-10",
  "isc - xi": "isc-11",
  "isc - xii": "isc-12",
};

(async () => {
  try {
    const rootChildren = await getFolder(NEW_ROOT_FOLDER_ID, "Lambda Prep");

    const outDir = "./output";
    fs.mkdirSync(outDir, { recursive: true });

    let doxxmarksNode = null;

    for (const child of rootChildren) {
      if (child.type !== "folder") continue;
      const key = child.name.trim().toLowerCase();

      if (key === "doxxmarks") {
        doxxmarksNode = child;
        continue;
      }

      const slug = CLASS_FOLDER_TO_SLUG[key];
      if (!slug) {
        console.log(`⚠️ Unrecognized top-level folder, skipping: "${child.name}"`);
        continue;
      }

      const classOutDir = path.join(outDir, slug);
      fs.mkdirSync(classOutDir, { recursive: true });

      const cisce = child.children.find(f => f.type === "folder" && f.name.toLowerCase().includes("cisce"));
      const community = child.children.find(f => f.type === "folder" && f.name.toLowerCase().includes("community"));

      if (cisce) {
        fs.writeFileSync(path.join(classOutDir, "cisce.json"), JSON.stringify(cisce, null, 2));
        console.log(`✅ ${slug}/cisce.json created`);
      } else {
        console.log(`⚠️ "${child.name}": CISCE Resources folder not found`);
      }

      if (community) {
        fs.writeFileSync(path.join(classOutDir, "community.json"), JSON.stringify(community, null, 2));
        console.log(`✅ ${slug}/community.json created`);
      } else {
        console.log(`⚠️ "${child.name}": Community Resources folder not found`);
      }
    }

    if (doxxmarksNode) {
      fs.writeFileSync(path.join(outDir, "doxxmarks.json"), JSON.stringify(doxxmarksNode, null, 2));
      console.log("✅ doxxmarks.json created");
    } else {
      console.log("⚠️ Doxxmarks folder not found");
    }

    // 🔥 CREATE FLATTENED SEARCH INDEX (kept from the previous crawler, now
    // covering the whole new root in one flat list)
    function flattenTree(node, result = []) {
      if (node.type === "file") {
        result.push({
          name: node.name,
          id: node.id,
          path: node.path,
          mimeType: node.mimeType,
          createdTime: node.createdTime,
          modifiedTime: node.modifiedTime,
          size: node.size,
        });
      }
      if (node.type === "folder" && node.children) {
        for (const child of node.children) {
          flattenTree(child, result);
        }
      }
      return result;
    }

    const flat = flattenTree({ type: "folder", children: rootChildren });
    fs.writeFileSync(path.join(outDir, "search-index.json"), JSON.stringify(flat, null, 2));
    console.log("✅ search-index.json created");
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exitCode = 1;
  }
})();
