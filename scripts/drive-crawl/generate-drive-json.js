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

// 🔥 FLATTEN FUNCTION (added)
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

// 🏁 Main
(async () => {
  try {
    const ROOT_FOLDER_ID = "1CkUuGnUR3idrhEBxgiV5U9fFf5RjbZQK";
    const ISC11_FOLDER_ID = "1ms1X7bkoF1igt8xFa_dCqTri_9IX8RbR";

    const rootMeta = await withRetry(
      () =>
        drive.files.get({
          fileId: ROOT_FOLDER_ID,
          fields: "name",
        }),
      `files.get(${ROOT_FOLDER_ID})`
    );

    const rootName = rootMeta.data.name;

    const rootChildren = await getFolder(ROOT_FOLDER_ID, rootName);

    // 🔥 Find specific folders
    const cisce = rootChildren.find(f =>
      f.name.toLowerCase().includes("cisce")
    );

    const study = rootChildren.find(f =>
      f.name.toLowerCase().includes("study")
    );

    const outDir = "./output";
    fs.mkdirSync(outDir, { recursive: true });

    // 📝 Write tree files
    if (cisce) {
      fs.writeFileSync(
        path.join(outDir, "cisce-resources.json"),
        JSON.stringify(cisce, null, 2)
      );
      console.log("✅ cisce-resources.json created");
    } else {
      console.log("⚠️ CISCE folder not found");
    }

    if (study) {
      fs.writeFileSync(
        path.join(outDir, "study-materials.json"),
        JSON.stringify(study, null, 2)
      );
      console.log("✅ study-materials.json created");
    } else {
      console.log("⚠️ Study Materials folder not found");
    }

    // 📚 ISC - XI community resources (separate Drive root): crawl its
    // subject subfolders (Chemistry, English, Maths, Physics, ...) and
    // write each as its own tree file, matching what
    // transform-isc11-resources.py expects (one file per subject folder,
    // rooted at the subject folder itself).
    const isc11Meta = await withRetry(
      () =>
        drive.files.get({
          fileId: ISC11_FOLDER_ID,
          fields: "name",
        }),
      `files.get(${ISC11_FOLDER_ID})`
    );
    const isc11Children = await getFolder(ISC11_FOLDER_ID, isc11Meta.data.name);

    const isc11OutDir = path.join(outDir, "isc-11");
    fs.mkdirSync(isc11OutDir, { recursive: true });

    const isc11SubjectFolders = isc11Children.filter(f => f.type === "folder");
    for (const subjectFolder of isc11SubjectFolders) {
      const slug = subjectFolder.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      fs.writeFileSync(
        path.join(isc11OutDir, `${slug}.json`),
        JSON.stringify(subjectFolder, null, 2)
      );
      console.log(`✅ isc-11/${slug}.json created (${subjectFolder.name})`);
    }
    if (isc11SubjectFolders.length === 0) {
      console.log("⚠️ ISC - XI folder had no subject subfolders");
    }

    // 🔥 CREATE FLATTENED SEARCH INDEX (added)
    const flat = flattenTree({
      type: "folder",
      children: rootChildren,
    });

    fs.writeFileSync(
      path.join(outDir, "search-index.json"),
      JSON.stringify(flat, null, 2)
    );

    console.log("✅ search-index.json created");

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();
