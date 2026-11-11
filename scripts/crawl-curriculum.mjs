#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const API_BASE = "https://apigateway.extramarks.com";
const CDN_BASE = "https://mscontent-gcp.extramarks.com/";
const DEFAULT_BOARD_ID = 404;
const DEFAULT_CLASS_ID = 19727898;
const DEFAULT_LANGUAGE_ID = 1;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;
const REQUEST_DELAY_MS = 120;

const ACTIVITY_GROUPS = new Set([
  "Practice Game",
  "Custom Interactive",
  "Interactive Simulation",
  "Case Study - EMR",
  "3D Interactive",
  "Virtual Lab",
  "Math Lab",
]);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function normalizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function dedupeRecords(records) {
  const byId = new Map();

  for (const record of records) {
    const key = record.contentId
      ? `id:${record.contentId}`
      : `fallback:${record.chapter}|${record.title}|${record.rawUrl}`;
    const previous = byId.get(key);

    if (!previous || (previous.nodeType === "chapter" && record.nodeType === "topic")) {
      byId.set(key, record);
    }
  }

  return [...byId.values()];
}

export function isActivityRecord(record, subjectName) {
  if (record.contentType === "Games") return true;
  if (ACTIVITY_GROUPS.has(record.contentGroup)) return true;
  if (
    record.category === "Practice" &&
    record.contentType === "HTML" &&
    record.contentGroup === "School Map"
  ) {
    return true;
  }
  return subjectName.toLowerCase() === "mathematics" && record.contentGroup === "Senior";
}

export function mapActivityType(record, subjectName) {
  if (record.contentGroup === "Case Study - EMR") return "Case Study (HOTS)";
  if (subjectName.toLowerCase() === "mathematics" && record.contentGroup === "Senior") {
    return "Math Lab";
  }
  return record.contentGroup;
}

export function buildContentUrl(record, cdnBase = CDN_BASE) {
  const rawPath = record.rawUrl.replace(/^\/+/, "");

  if (
    record.contentType === "PDF" &&
    record.contentGroup === "Virtual Lab" &&
    !/\.[a-z0-9]{2,5}(?:$|[?#])/i.test(rawPath)
  ) {
    const directory = rawPath.replace(/\/+$/, "");
    const wrapper = new URL("/template/154/dir24_154/index.html", cdnBase);
    wrapper.searchParams.set("contentPath", new URL(`${directory}/`, cdnBase).href);
    wrapper.searchParams.set("isAllowFS", "true");
    return wrapper.href;
  }

  return new URL(rawPath, cdnBase).href;
}

function findClosingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return index;
  }

  return -1;
}

export function replaceSubjectBlock(text, { board, className, subjectName }, subject) {
  const parsed = JSON.parse(text);
  const subjects = parsed.boards?.[board]?.classes?.[className]?.subjects;
  const subjectIndex = subjects?.findIndex((item) => item.name === subjectName) ?? -1;
  if (subjectIndex < 0)
    throw new Error(`${board} Class ${className} ${subjectName} entry not found`);

  const boardIndex = text.indexOf(`${JSON.stringify(board)}: {`);
  const classesIndex = text.indexOf('"classes": {', boardIndex);
  const classIndex = text.indexOf(`${JSON.stringify(className)}: {`, classesIndex);
  const subjectsIndex = text.indexOf('"subjects": [', classIndex);
  const nameIndex = text.indexOf(`"name": ${JSON.stringify(subjectName)}`, subjectsIndex);
  const start = text.lastIndexOf("{", nameIndex);

  if (boardIndex < 0 || classesIndex < 0 || classIndex < 0 || subjectsIndex < 0 || nameIndex < 0) {
    throw new Error(`Could not locate ${board} Class ${className} ${subjectName} block`);
  }

  const lineStart = text.lastIndexOf("\n", start) + 1;
  const indentation = text.slice(lineStart, start);
  if (indentation.trim()) throw new Error("Could not determine subject indentation");

  const end = findClosingBrace(text, start);
  if (end < 0) throw new Error(`Could not find end of ${subjectName} block`);

  const replacement = JSON.stringify(subject, null, 3)
    .split("\n")
    .map((line) => indentation + line)
    .join("\n");
  const updated = text.slice(0, start) + replacement + text.slice(end + 1);
  const updatedData = JSON.parse(updated);

  const expected = structuredClone(parsed);
  expected.boards[board].classes[className].subjects[subjectIndex] = subject;
  if (JSON.stringify(updatedData) !== JSON.stringify(expected)) {
    throw new Error("Subject splice changed data outside the selected subject");
  }

  return updated;
}

async function fetchWithRetry(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
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
  return {
    Authorization: `Bearer ${token}`,
    token,
    Accept: "application/json",
  };
}

function buildRecord(node, group, content) {
  const tags = Object.fromEntries(
    (content.tag_data ?? []).map((tag) => [tag.tagName, tag.tagValue]),
  );

  return {
    chapter: node.chapter,
    nodeName: node.nodeName,
    nodeType: node.nodeType,
    title: content.content_title ?? "",
    rawUrl: content.content_url ?? "",
    contentId: content.content_id,
    category: group.group_category_name ?? "",
    contentType: tags["Content Type"] ?? "",
    contentGroup: tags["Content Group"] ?? "",
    tags,
  };
}

export function isLessonRecord(record, { subjectName, board, className }) {
  return (
    record.category === "Learn" &&
    ((record.contentType === "HTML" && ["SLM - EMR", "SLM"].includes(record.contentGroup)) ||
      (record.contentType === "Nucleus" && record.contentGroup === "CRS") ||
      (record.contentType === "Animation" &&
        record.contentGroup === "CRS" &&
        normalizeName(record.tags.Subject ?? "") === normalizeName(subjectName) &&
        normalizeName(record.tags.Board ?? "") === normalizeName(board) &&
        normalizeName(record.tags.Class ?? "") === normalizeName(className)))
  );
}

async function getChildList(boardId, syllabusId, languageId, headers) {
  const response = await fetchJson(childListUrl(boardId, syllabusId, languageId), { headers });
  return response.data?.child_list ?? [];
}

export async function collectSubject({
  subjectName,
  board = "ICSE",
  className = "X",
  token,
  boardId = DEFAULT_BOARD_ID,
  classId = DEFAULT_CLASS_ID,
  languageId = DEFAULT_LANGUAGE_ID,
  onProgress = () => {},
}) {
  const headers = authHeaders(token);
  const classChildren = await getChildList(boardId, classId, languageId, headers);
  const subjectNode = classChildren.find(
    (item) => item.name.toLowerCase() === subjectName.toLowerCase(),
  );
  if (!subjectNode) throw new Error(`Subject not found in class list: ${subjectName}`);

  const chapterNodes = await getChildList(boardId, subjectNode.syllabus_id, languageId, headers);
  const structure = [];
  const nodes = [];

  for (const chapter of chapterNodes) {
    const topicNodes = await getChildList(boardId, chapter.syllabus_id, languageId, headers);
    structure.push({ name: chapter.name, topics: topicNodes.map((topic) => topic.name) });
    nodes.push({
      chapter: chapter.name,
      nodeName: chapter.name,
      nodeType: "chapter",
      syllabusId: chapter.syllabus_id,
    });
    for (const topic of topicNodes) {
      nodes.push({
        chapter: chapter.name,
        nodeName: topic.name,
        nodeType: "topic",
        syllabusId: topic.syllabus_id,
      });
    }
  }

  const lessonRows = [];
  const activityRows = [];
  const taxonomy = {};

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const response = await fetchJson(
      syllabusDataUrl(boardId, classId, node.syllabusId, languageId),
      { headers },
    );

    for (const group of response.data?.group_list ?? []) {
      for (const content of group.content_data ?? []) {
        const record = buildRecord(node, group, content);
        const key = `${record.category}|${record.contentType}|${record.contentGroup}`;
        taxonomy[key] = (taxonomy[key] ?? 0) + 1;
        if (isLessonRecord(record, { subjectName, board, className })) lessonRows.push(record);
        if (isActivityRecord(record, subjectName)) activityRows.push(record);
      }
    }

    onProgress({ completed: index + 1, total: nodes.length, node: node.nodeName });
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    subjectName,
    board,
    className,
    subjectId: subjectNode.syllabus_id,
    structure,
    nodes,
    taxonomy,
    rawLessonCount: lessonRows.length,
    rawActivityCount: activityRows.length,
    lessons: dedupeRecords(lessonRows),
    activities: dedupeRecords(activityRows),
  };
}

function normalizeLegacyMediaUrl(value) {
  const url = new URL(value);
  url.protocol = "https:";
  if (url.hostname === "nemrnew1.extramarks.com") {
    url.hostname = "mscontent-gcp.extramarks.com";
  }
  return url;
}

function playlistEntries(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function verifyVideo(record) {
  try {
    let mediaUrl;
    if (record.contentType === "Animation" && /\.mp4(?:$|[?#])/i.test(record.rawUrl)) {
      mediaUrl = normalizeLegacyMediaUrl(new URL(record.rawUrl.replace(/^\/+/, ""), CDN_BASE).href);
    } else {
      const metadataUrl = new URL(record.rawUrl.replace(/^\/+/, ""), CDN_BASE);
      const metadata = await fetchJson(metadataUrl.href);
      if (!metadata.content_url) throw new Error("Metadata has no content_url");
      mediaUrl = normalizeLegacyMediaUrl(metadata.content_url);
    }
    const mediaDirectory = `${mediaUrl.pathname.slice(0, mediaUrl.pathname.lastIndexOf("/") + 1)}output/`;
    const outputDirectory = new URL(mediaDirectory, mediaUrl.origin);
    const manifestUrl = new URL("manifest.m3u8", outputDirectory);
    let response = await fetchWithRetry(manifestUrl.href);
    let guessedNoManifest = false;

    if (!response.ok) {
      const mp4Name = path.posix.basename(mediaUrl.pathname).replace(/\.mp4$/i, "");
      const guessedUrl = new URL(`${mp4Name}-hd.m3u8`, outputDirectory);
      response = await fetchWithRetry(guessedUrl.href);
      if (!response.ok) {
        throw new Error(
          `manifest ${manifestUrl.href} returned 404; guessed playlist returned ${response.status}`,
        );
      }
      guessedNoManifest = true;
      manifestUrl.href = guessedUrl.href;
    }

    let playlistText = await response.text();
    let currentPlaylistUrl = manifestUrl;
    let segmentUrl;

    for (let depth = 0; depth < 3; depth += 1) {
      const entries = playlistEntries(playlistText);
      const variants = entries.filter((entry) => entry.toLowerCase().endsWith(".m3u8"));
      if (variants.length) {
        const selected = variants.find((entry) => /hd/i.test(entry)) ?? variants[0];
        currentPlaylistUrl = new URL(selected, currentPlaylistUrl);
        const variantResponse = await fetchWithRetry(currentPlaylistUrl.href);
        if (!variantResponse.ok)
          throw new Error(`variant playlist returned ${variantResponse.status}`);
        playlistText = await variantResponse.text();
        continue;
      }

      const segment = entries.find((entry) => !entry.toLowerCase().endsWith(".m3u8"));
      if (segment) {
        segmentUrl = new URL(segment, currentPlaylistUrl);
        break;
      }
    }

    if (!segmentUrl) throw new Error("No media segment found in playlist");
    const segmentResponse = await fetchWithRetry(segmentUrl.href, {
      headers: { Range: "bytes=0-256" },
    });
    if (!segmentResponse.ok)
      throw new Error(`first media segment returned ${segmentResponse.status}`);
    await segmentResponse.body?.cancel();

    return {
      record,
      link: currentPlaylistUrl.href,
      guessedNoManifest,
      manifestStatus: response.status,
      segmentStatus: segmentResponse.status,
    };
  } catch (error) {
    return { record, error: error.message };
  }
}

function findTopicForRecord(chapter, record) {
  if (record.nodeType === "topic") {
    const exact = chapter.topics.find((topic) => topic.name === record.nodeName);
    if (exact) return exact;
  }

  const normalizedTitle = normalizeName(record.title);
  const matchingTitle = chapter.topics.find(
    (topic) => normalizeName(topic.name) === normalizedTitle,
  );
  if (matchingTitle) return matchingTitle;

  let chapterTopic = chapter.topics.find((topic) => topic.name === chapter.name);
  if (!chapterTopic) {
    chapterTopic = {
      name: chapter.name,
      interactiveClasses: [],
      videoLessons: [],
    };
    chapter.topics.push(chapterTopic);
  }
  return chapterTopic;
}

export function buildCurriculumSubject(crawl, resolvedVideos) {
  const chapters = crawl.structure.map((chapter) => ({
    name: chapter.name,
    topics: chapter.topics.map((name) => ({
      name,
      interactiveClasses: [],
      videoLessons: [],
    })),
  }));
  const chapterByName = new Map(chapters.map((chapter) => [chapter.name, chapter]));
  const videoById = new Map(
    resolvedVideos.filter((item) => item.link).map((item) => [item.record.contentId, item]),
  );

  for (const record of crawl.lessons) {
    const chapter = chapterByName.get(record.chapter);
    if (!chapter) continue;
    const topic = findTopicForRecord(chapter, record);

    if (record.contentType === "HTML") {
      topic.interactiveClasses.push({
        name: record.title,
        link: buildContentUrl(record),
      });
    } else {
      const video = videoById.get(record.contentId);
      if (video) topic.videoLessons.push({ name: record.title, link: video.link });
    }
  }

  for (const record of crawl.activities) {
    const chapter = chapterByName.get(record.chapter);
    if (!chapter) continue;
    const topic = findTopicForRecord(chapter, record);
    const activity = {
      type: mapActivityType(record, crawl.subjectName),
      title: record.title,
      link: buildContentUrl(record),
    };
    (topic.activities ??= []).push(activity);
  }

  const unresolved = resolvedVideos.filter((item) => !item.link);
  const board = crawl.board ?? "ICSE";
  const className = crawl.className ?? "X";
  const comment = unresolved.length
    ? `Extramarks ${board} Class ${className} ${crawl.subjectName}; unresolved HLS videos omitted (${unresolved.length}). See crawl report.`
    : `Extramarks ${board} Class ${className} ${crawl.subjectName} curriculum.`;

  return { __comment: comment, name: crawl.subjectName, chapters };
}

async function verifyHttpLink(item) {
  try {
    const response = await fetchWithRetry(item.link, {
      headers: { Range: "bytes=0-4095" },
    });
    const body = await response.arrayBuffer();
    return {
      kind: item.kind,
      title: item.title,
      link: item.link,
      status: response.status,
      bytesRead: body.byteLength,
      ok: response.ok && body.byteLength > 0,
    };
  } catch (error) {
    return { kind: item.kind, title: item.title, link: item.link, ok: false, error: error.message };
  }
}

class CDPConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }

      for (const handler of this.handlers.get(message.method) ?? []) {
        handler(message.params);
      }
    });
  }

  static async connect(url) {
    if (typeof WebSocket !== "function")
      throw new Error("This Node version does not provide WebSocket");
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("CDP WebSocket connection timed out")),
        10_000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Could not connect to CDP target WebSocket"));
        },
        { once: true },
      );
    });
    return new CDPConnection(socket);
  }

  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? new Set();
    handlers.add(handler);
    this.handlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`CDP event timed out: ${method}`));
      }, timeoutMs);
      const unsubscribe = this.on(method, (params) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(params);
      });
    });
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
    this.socket.close();
  }
}

async function runRenderChecks(urls, { cdpUrl, screenshotsDir, settleMs }) {
  const targetsResponse = await fetchWithRetry(new URL("/json/list", cdpUrl).href);
  if (!targetsResponse.ok) throw new Error(`CDP target list returned ${targetsResponse.status}`);
  const targets = await targetsResponse.json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("No debuggable browser page found at the CDP endpoint");

  await fs.mkdir(screenshotsDir, { recursive: true });
  const client = await CDPConnection.connect(target.webSocketDebuggerUrl);
  const results = [];

  try {
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Network.enable");

    for (let index = 0; index < urls.length; index += 1) {
      const item = urls[index];
      const failures = [];
      const onResponse = ({ response }) => {
        if (response.status >= 400) failures.push({ status: response.status, url: response.url });
      };
      const offResponse = client.on("Network.responseReceived", onResponse);
      let navigationError;

      try {
        const loadEvent = client.waitFor("Page.loadEventFired", 15_000).catch(() => null);
        const navigation = await client.call("Page.navigate", { url: item.link });
        navigationError = navigation.errorText;
        await loadEvent;
        await sleep(settleMs);

        const evaluated = await client.call("Runtime.evaluate", {
          expression: `(() => ({
            title: document.title,
            text: (document.body?.innerText || "").slice(0, 250),
            images: [...(document.images || [])].filter((image) => image.complete && image.naturalWidth > 0).length,
            canvases: [...document.querySelectorAll("canvas")].map((canvas) => ({ width: canvas.width, height: canvas.height }))
          }))()`,
          returnByValue: true,
        });
        const state = evaluated.result?.value ?? {};
        const screenshot = await client.call("Page.captureScreenshot", {
          format: "jpeg",
          quality: 60,
          captureBeyondViewport: false,
        });
        const image = Buffer.from(screenshot.data, "base64");
        const filename = `${String(index + 1).padStart(3, "0")}-${slugify(item.title)}.jpg`;
        await fs.writeFile(path.join(screenshotsDir, filename), image);
        const suspicious =
          image.byteLength < 6000 ||
          (!state.text &&
            !state.images &&
            !(state.canvases ?? []).some((canvas) => canvas.width > 0));

        results.push({
          title: item.title,
          kind: item.kind,
          link: item.link,
          screenshot: filename,
          screenshotBytes: image.byteLength,
          suspicious,
          navigationError,
          page: state,
          assetFailures: failures.slice(0, 10),
        });
      } catch (error) {
        results.push({ title: item.title, kind: item.kind, link: item.link, error: error.message });
      } finally {
        offResponse();
      }
    }
  } finally {
    client.close();
  }

  return results;
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "content"
  );
}

function parseArgs(args) {
  const options = {
    board: "ICSE",
    className: "X",
    boardId: DEFAULT_BOARD_ID,
    classId: DEFAULT_CLASS_ID,
    languageId: DEFAULT_LANGUAGE_ID,
    apply: false,
    cdpUrl: process.env.EXTRAMARKS_CDP_URL,
    reportPath: null,
    screenshotsDir: null,
    settleMs: 1800,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--subject") options.subjectName = args[++index];
    else if (argument === "--board") options.board = args[++index];
    else if (argument === "--class") options.className = args[++index];
    else if (argument === "--board-id") options.boardId = Number(args[++index]);
    else if (argument === "--class-id") options.classId = Number(args[++index]);
    else if (argument === "--language-id") options.languageId = Number(args[++index]);
    else if (argument === "--apply") options.apply = true;
    else if (argument === "--cdp-url") options.cdpUrl = args[++index];
    else if (argument === "--report") options.reportPath = args[++index];
    else if (argument === "--curriculum") options.curriculumPath = args[++index];
    else if (argument === "--screenshots-dir") options.screenshotsDir = args[++index];
    else if (argument === "--settle-ms") options.settleMs = Number(args[++index]);
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  EXTRAMARKS_TOKEN=<token> node scripts/crawl-curriculum.mjs --subject Mathematics [options]

Options:
  --subject NAME          Required subject name (for example Mathematics)
  --board NAME            Board key (default ICSE)
  --class ROMAN           Class key (default X)
  --board-id ID           Extramarks board ID (default 404)
  --class-id ID           Extramarks class syllabus ID (default 19727898)
  --language-id ID        Extramarks language ID (default 1)
  --apply                 Surgically replace that subject in curriculum.json
  --report PATH           Write the crawl and verification report to PATH
  --curriculum PATH       Curriculum JSON path (defaults to src/data/curriculum.json)
  --cdp-url URL           Optional local Chrome DevTools endpoint for screenshots
  --screenshots-dir DIR   Screenshot output directory (defaults to the OS temp directory)
  --settle-ms N           Wait after navigation before capture (default 1800)
  --help                  Show this help

The token is read only from EXTRAMARKS_TOKEN and is never written to reports.
Without --apply, the curriculum file is left unchanged.`);
}

export async function runCli(options, token) {
  const crawl = await collectSubject({
    subjectName: options.subjectName,
    board: options.board,
    className: options.className,
    token,
    boardId: options.boardId,
    classId: options.classId,
    languageId: options.languageId,
    onProgress: ({ completed, total }) => {
      process.stderr.write(`\rCrawling syllabus nodes: ${completed}/${total}`);
    },
  });
  process.stderr.write("\nResolving video playlists and first segments...\n");

  const videoResults = await mapLimit(
    crawl.lessons.filter(
      (record) =>
        record.contentType === "Nucleus" ||
        (record.contentType === "Animation" && /\.mp4(?:$|[?#])/i.test(record.rawUrl)),
    ),
    10,
    verifyVideo,
  );
  const subject = buildCurriculumSubject(crawl, videoResults);
  const linkItems = [
    ...subject.chapters.flatMap((chapter) =>
      chapter.topics.flatMap((topic) => [
        ...topic.interactiveClasses.map((item) => ({
          kind: "interactive",
          title: item.name,
          link: item.link,
        })),
        ...(topic.activities ?? []).map((item) => ({
          kind: "activity",
          title: item.title,
          link: item.link,
        })),
      ]),
    ),
  ];
  process.stderr.write(`Checking ${linkItems.length} HTML and activity URLs...\n`);
  const linkChecks = await mapLimit(linkItems, 10, verifyHttpLink);

  let renderChecks = null;
  let screenshotsDir = null;
  if (options.cdpUrl) {
    screenshotsDir =
      options.screenshotsDir ??
      path.join(os.tmpdir(), `extramarks-${slugify(options.subjectName)}-screenshots`);
    renderChecks = await runRenderChecks(linkItems, {
      cdpUrl: options.cdpUrl,
      screenshotsDir,
      settleMs: options.settleMs,
    });
  }

  const curriculumPath = path.resolve(
    options.curriculumPath ?? path.join(PROJECT_ROOT, "src/data/curriculum.json"),
  );
  if (options.apply) {
    const original = await fs.readFile(curriculumPath, "utf8");
    const updated = replaceSubjectBlock(
      original,
      {
        board: options.board,
        className: options.className,
        subjectName: options.subjectName,
      },
      subject,
    );
    await fs.writeFile(curriculumPath, updated);
  }

  const unresolvedVideos = videoResults.filter((item) => !item.link);
  const report = {
    subject: options.subjectName,
    board: options.board,
    class: options.className,
    subjectId: crawl.subjectId,
    crawl: {
      nodeCount: crawl.nodes.length,
      rawLessonCount: crawl.rawLessonCount,
      uniqueLessonCount: crawl.lessons.length,
      interactiveClassCount: subject.chapters.reduce(
        (sum, chapter) =>
          sum + chapter.topics.reduce((n, topic) => n + topic.interactiveClasses.length, 0),
        0,
      ),
      resolvedVideoCount: subject.chapters.reduce(
        (sum, chapter) =>
          sum + chapter.topics.reduce((n, topic) => n + topic.videoLessons.length, 0),
        0,
      ),
      rawActivityCount: crawl.rawActivityCount,
      uniqueActivityCount: crawl.activities.length,
      taxonomy: crawl.taxonomy,
    },
    unresolvedVideos: unresolvedVideos.map((item) => ({
      title: item.record.title,
      chapter: item.record.chapter,
      error: item.error,
    })),
    linkChecks,
    renderChecks,
    screenshotsDir,
    curriculumApplied: options.apply,
    subjectData: subject,
  };

  if (options.reportPath) {
    const reportPath = path.resolve(options.reportPath);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(
    JSON.stringify(
      {
        subject: report.subject,
        chapters: subject.chapters.length,
        ...report.crawl,
        unresolvedVideos: report.unresolvedVideos,
        failedHttpChecks: linkChecks.filter((item) => !item.ok),
        renderReviewNeeded:
          renderChecks?.filter((item) => item.suspicious || item.error).map((item) => item.title) ??
          null,
        screenshotsDir,
        curriculumApplied: options.apply,
        reportPath: options.reportPath ? path.resolve(options.reportPath) : null,
      },
      null,
      2,
    ),
  );

  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.subjectName) throw new Error("--subject is required");
  const token = process.env.EXTRAMARKS_TOKEN?.trim();
  if (!token)
    throw new Error(
      "Set EXTRAMARKS_TOKEN in the environment; do not pass it as a command-line argument",
    );
  await runCli(options, token);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Crawl failed: ${error.message}`);
    process.exitCode = 1;
  });
}