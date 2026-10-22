export interface ResourceItem {
  name: string;
  id: string;
  group: string;
  type?: 'file';
  mimeType?: string | null;
  createdTime?: string | null;
  modifiedTime?: string | null;
  size?: string | number | null;
}
export interface ResourceFolderNode {
  type: 'folder';
  name: string;
  children: ResourceNode[];
}
export type ResourceNode = ResourceItem | ResourceFolderNode;
export interface ResourceSubject {
  subject: string;
  items: ResourceItem[];
  editorFolders?: ResourceFolderNode[];
  /** Which rendered group these `editorFolders` attach to — e.g. "General"
   * for Community's curated Julius Caesar-style folders, or "CISCE
   * Resources" for CISCE's APF/CFQ/PYQ/SQP/Syllabus year-folder nav.
   * Defaults to "General" when a dataset predates this field. */
  editorFoldersGroup?: string | undefined;
}
export interface ResourceDataset { subjects: ResourceSubject[]; misc: ResourceItem[]; }
/** Lightweight manifest: subject names + counts only, no file lists — cheap
 * enough to load up front so the subject-card grid can render instantly,
 * before any subject's actual files are fetched. */
export interface ResourceManifest { subjects: Array<{ subject: string; slug: string; count: number }>; miscCount: number }

type SourceId = 'cisce' | 'community';

// Only ICSE Class 10 and ISC Class 11 have real indexed content today; other
// classes fall back to the "coming soon" empty state in SourceClassPicker.
//
// Two loading strategies coexist here:
//  - "monolithic" datasets are loaded as one dynamic import (fine when the
//    whole dataset is small, e.g. CISCE ICSE-10 at ~65KB).
//  - "split" datasets are pre-sharded per subject at build time (see
//    scripts/transform-resources.py) into src/data/<dataset>/<slug>.json +
//    manifest.json + misc.json, so visiting one subject only ever fetches
//    that subject's JSON instead of the whole multi-MB blob.
const MONOLITHIC_LOADERS: Record<SourceId, Record<string, () => Promise<{ default: unknown }>>> = {
  cisce: {
    'icse-9': () => import('@/data/resources-cisce-icse-9.json'),
    'icse-10': () => import('@/data/resources-cisce-icse-10.json'),
    'isc-11': () => import('@/data/resources-cisce-isc-11.json'),
    'isc-12': () => import('@/data/resources-cisce-isc-12.json'),
  },
  community: {
    'icse-9': () => import('@/data/resources-community-icse-9.json'),
    'isc-11': () => import('@/data/resources-community-isc-11.json'),
    'isc-12': () => import('@/data/resources-community-isc-12.json'),
  },
};

// Split datasets: manifest + per-subject + misc loaders, keyed the same way.
const SPLIT_MANIFEST_LOADERS: Record<SourceId, Record<string, () => Promise<{ default: unknown }>>> = {
  cisce: {},
  community: {
    'icse-10': () => import('@/data/resources-community-icse-10/manifest.json'),
  },
};
const SPLIT_SUBJECT_LOADERS: Record<SourceId, Record<string, Record<string, () => Promise<{ default: unknown }>>>> = {
  cisce: {},
  community: {
    'icse-10': {
      featured: () => import('@/data/resources-community-icse-10/featured.json'),
      biology: () => import('@/data/resources-community-icse-10/biology.json'),
      chemistry: () => import('@/data/resources-community-icse-10/chemistry.json'),
      'commercial-applications': () => import('@/data/resources-community-icse-10/commercial-applications.json'),
      'commercial-studies': () => import('@/data/resources-community-icse-10/commercial-studies.json'),
      'computer-applications': () => import('@/data/resources-community-icse-10/computer-applications.json'),
      'economic-applications': () => import('@/data/resources-community-icse-10/economic-applications.json'),
      economics: () => import('@/data/resources-community-icse-10/economics.json'),
      'english-language': () => import('@/data/resources-community-icse-10/english-language.json'),
      'literature-in-english': () => import('@/data/resources-community-icse-10/literature-in-english.json'),
      geography: () => import('@/data/resources-community-icse-10/geography.json'),
      hindi: () => import('@/data/resources-community-icse-10/hindi.json'),
      'history-civics': () => import('@/data/resources-community-icse-10/history-civics.json'),
      mathematics: () => import('@/data/resources-community-icse-10/mathematics.json'),
      physics: () => import('@/data/resources-community-icse-10/physics.json'),
    },
  },
};
const SPLIT_MISC_LOADERS: Record<SourceId, Record<string, () => Promise<{ default: unknown }>>> = {
  cisce: {},
  community: {
    'icse-10': () => import('@/data/resources-community-icse-10/misc.json'),
  },
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isSplit(source: SourceId, classSlug: string): boolean {
  return classSlug in SPLIT_MANIFEST_LOADERS[source];
}

export function hasResourceDataset(source: SourceId, classSlug: string): boolean {
  return classSlug in MONOLITHIC_LOADERS[source] || isSplit(source, classSlug);
}

const manifestCache = new Map<string, ResourceManifest>();
const datasetCache = new Map<string, ResourceDataset>();
const subjectCache = new Map<string, ResourceSubject>();
const miscCache = new Map<string, ResourceItem[]>();

/** For split datasets: fetch only the manifest (subject names + counts),
 * enough to render the subject-card grid without downloading any file
 * lists yet. For monolithic datasets, this just loads (and caches) the
 * whole thing and derives an equivalent manifest from it. */
export async function loadResourceManifest(source: SourceId, classSlug: string): Promise<ResourceManifest | undefined> {
  const key = `${source}/${classSlug}`;
  if (isSplit(source, classSlug)) {
    const cached = manifestCache.get(key);
    if (cached) return cached;
    const loader = SPLIT_MANIFEST_LOADERS[source][classSlug];
    if (!loader) return undefined;
    const mod = await loader();
    const manifest = mod.default as ResourceManifest;
    manifestCache.set(key, manifest);
    return manifest;
  }
  const dataset = await loadResourceDataset(source, classSlug);
  if (!dataset) return undefined;
  return {
    subjects: dataset.subjects.map(s => ({
      subject: s.subject,
      slug: slugify(s.subject),
      count: s.items.length + (s.editorFolders?.reduce((n, f) => n + flattenFolderFiles(f).length, 0) ?? 0),
    })),
    miscCount: dataset.misc.length,
  };
}

/** Fetch a single subject's file list (split datasets only fetch that
 * subject's JSON shard; monolithic datasets load the whole thing once,
 * cached, then slice out the requested subject). */
export async function loadResourceSubject(source: SourceId, classSlug: string, subject: string): Promise<ResourceSubject | undefined> {
  const slug = slugify(subject);
  const key = `${source}/${classSlug}/${slug}`;
  if (isSplit(source, classSlug)) {
    const cached = subjectCache.get(key);
    if (cached) return cached;
    const loader = SPLIT_SUBJECT_LOADERS[source][classSlug]?.[slug];
    if (!loader) return undefined;
    const mod = await loader();
    const payload = mod.default as { items: ResourceItem[]; editorFolders?: ResourceFolderNode[]; editorFoldersGroup?: string };
    const result: ResourceSubject = payload.editorFolders
      ? { subject, items: payload.items, editorFolders: payload.editorFolders, editorFoldersGroup: payload.editorFoldersGroup }
      : { subject, items: payload.items };
    subjectCache.set(key, result);
    return result;
  }
  const dataset = await loadResourceDataset(source, classSlug);
  return dataset?.subjects.find(s => s.subject === subject);
}

/** Fetch the Miscellaneous bucket on its own (split datasets fetch just
 * misc.json; monolithic datasets reuse the already-loaded dataset). */
export async function loadResourceMisc(source: SourceId, classSlug: string): Promise<ResourceItem[]> {
  const key = `${source}/${classSlug}`;
  if (isSplit(source, classSlug)) {
    const cached = miscCache.get(key);
    if (cached) return cached;
    const loader = SPLIT_MISC_LOADERS[source][classSlug];
    if (!loader) return [];
    const mod = await loader();
    const misc = mod.default as ResourceItem[];
    miscCache.set(key, misc);
    return misc;
  }
  const dataset = await loadResourceDataset(source, classSlug);
  return dataset?.misc ?? [];
}

/** A single file match from a broad (cross-subject or cross-class) search,
 * carrying enough context (which class + subject it lives in) to render a
 * subtitle and to link straight back into that subject's file viewer. */
export interface ResourceSearchHit { item: ResourceItem; classSlug: string; subject: string }

const classFilesCache = new Map<string, ResourceSearchHit[]>();
const sourceFilesCache = new Map<SourceId, ResourceSearchHit[]>();

/** Every file in one class (across all its subjects, misc bucket and any
 * Editor's Choice folder nesting), confined to the given source. Used by the
 * class-level "search this class" broad search — loaded once per class on
 * first use (not on every keystroke) and cached, so refining the query
 * after that is pure in-memory filtering. */
export async function loadAllClassFiles(source: SourceId, classSlug: string): Promise<ResourceSearchHit[]> {
  const key = `${source}/${classSlug}`;
  const cached = classFilesCache.get(key);
  if (cached) return cached;
  if (!hasResourceDataset(source, classSlug)) return [];
  const manifest = await loadResourceManifest(source, classSlug);
  if (!manifest) return [];
  const hits: ResourceSearchHit[] = [];
  for (const { subject } of manifest.subjects) {
    const entry = await loadResourceSubject(source, classSlug, subject);
    if (!entry) continue;
    for (const item of entry.items) hits.push({ item, classSlug, subject });
    for (const folder of entry.editorFolders ?? []) {
      for (const item of flattenFolderFiles(folder)) hits.push({ item, classSlug, subject });
    }
  }
  if (manifest.miscCount > 0) {
    const misc = await loadResourceMisc(source, classSlug);
    for (const item of misc) hits.push({ item, classSlug, subject: 'Miscellaneous' });
  }
  classFilesCache.set(key, hits);
  return hits;
}

/** Every file across every indexed class for a source. Used by the
 * top-level "search this source" broad search (e.g. every CISCE file,
 * across ICSE 9/10 and ISC 11/12 at once). `classSlugs` is the full list of
 * class slugs to consider — classes with no dataset yet are skipped. */
export async function loadAllSourceFiles(source: SourceId, classSlugs: readonly string[]): Promise<ResourceSearchHit[]> {
  const cached = sourceFilesCache.get(source);
  if (cached) return cached;
  const perClass = await Promise.all(
    classSlugs.filter(slug => hasResourceDataset(source, slug)).map(slug => loadAllClassFiles(source, slug))
  );
  const hits = perClass.flat();
  sourceFilesCache.set(source, hits);
  return hits;
}

export async function loadResourceDataset(source: SourceId, classSlug: string): Promise<ResourceDataset | undefined> {
  const key = `${source}/${classSlug}`;
  const cached = datasetCache.get(key);
  if (cached) return cached;
  const loader = MONOLITHIC_LOADERS[source][classSlug];
  if (!loader) return undefined;
  const mod = await loader();
  const dataset = mod.default as ResourceDataset;
  datasetCache.set(key, dataset);
  return dataset;
}

export function isFolderNode(node: ResourceNode): node is ResourceFolderNode {
  return (node as ResourceFolderNode).type === 'folder';
}

/** Flatten all file leaves inside a folder node (recursive), in display order. */
export function flattenFolderFiles(folder: ResourceFolderNode): ResourceItem[] {
  const out: ResourceItem[] = [];
  const walk = (node: ResourceNode) => {
    if (isFolderNode(node)) {
      node.children.forEach(walk);
    } else {
      out.push(node);
    }
  };
  folder.children.forEach(walk);
  return out;
}

/** Find the folder path (array of folder nodes, outer-to-inner) that directly
 * contains the given file id, searching the given folder tree recursively.
 * Returns null if the file isn't found under this tree. */
export function findFolderPathForFile(folders: ResourceFolderNode[], fileId: string): ResourceFolderNode[] | null {
  for (const folder of folders) {
    for (const child of folder.children) {
      if (!isFolderNode(child) && child.id === fileId) return [folder];
      if (isFolderNode(child)) {
        const nested = findFolderPathForFile([child], fileId);
        if (nested) return [folder, ...nested];
      }
    }
  }
  return null;
}

/** Resolve a Drive file id against a subject's loose items + its Editor's
 * Choice folder tree (used to reopen a deep-linked `?file=<id>` resource).
 * Returns the matching item plus the immediate folder it lives in, if any —
 * mirrors what the manual folder-card navigation in EditorChoiceNav tracks
 * as `activeFolderScope`, so a shared link into a nested file shows the
 * same scoped sidebar as clicking there would. */
export function findItemInSubject(
  subjectItems: ResourceItem[],
  editorFolders: ResourceFolderNode[] | undefined,
  fileId: string
): { item: ResourceItem; folderScope: ResourceFolderNode | null } | null {
  const loose = subjectItems.find(i => i.id === fileId);
  if (loose) return { item: loose, folderScope: null };
  if (editorFolders?.length) {
    const path = findFolderPathForFile(editorFolders, fileId);
    if (path) {
      const folderScope = path[path.length - 1]!;
      const item = folderScope.children.find((c): c is ResourceItem => !isFolderNode(c) && c.id === fileId);
      if (item) return { item, folderScope };
    }
  }
  return null;
}

export function groupItems(items: ResourceItem[]): Array<{ group: string; items: ResourceItem[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, ResourceItem[]>();
  for (const item of items) {
    if (!byGroup.has(item.group)) { byGroup.set(item.group, []); order.push(item.group); }
    byGroup.get(item.group)!.push(item);
  }
  const groups = order.map(group => ({ group, items: byGroup.get(group)! }));
  // Stable sort: General always first, then Sample Papers, then Solutions View,
  // then everything else (original order preserved), then PYQ Prelims last.
  return groups
    .map((g, i) => ({ ...g, i }))
    .sort((a, b) => getGroupPriority(a.group) - getGroupPriority(b.group) || a.i - b.i)
    .map(({ group, items }) => ({ group, items }));
}

function getGroupPriority(group: string): number {
  const g = group.toLowerCase();
  if (g === 'general') return 0;
  if (g.startsWith('sample paper')) return 1;
  if (g.startsWith('solutions view')) return 2;
  if (g.startsWith('pyq prelims')) return 4;
  return 3;
}

export function getGroupLabel(group: string): string {
  if (group.toLowerCase() === 'general') return "Editor's Choice";
  return group;
}

export function getGroupBadge(group: string): string | null {
  return group.toLowerCase() === 'general' ? 'Curated' : null;
}

export function isPremiumGroup(group: string): boolean {
  return group.toLowerCase() === 'general';
}

export type FileKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'other';

const EXT_KIND: Record<string, FileKind> = {
  pdf: 'pdf',
  doc: 'docx', docx: 'docx',
  xls: 'xlsx', xlsx: 'xlsx',
  ppt: 'pptx', pptx: 'pptx',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
};

export function getFileKind(name: string): FileKind {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  const ext = match?.[1]?.toLowerCase();
  return (ext && EXT_KIND[ext]) || 'other';
}
