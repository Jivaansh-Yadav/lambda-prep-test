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
export interface ResourceSubject { subject: string; items: ResourceItem[]; editorFolders?: ResourceFolderNode[]; }
export interface ResourceDataset { subjects: ResourceSubject[]; misc: ResourceItem[]; }

type SourceId = 'cisce' | 'community';

// Only ICSE Class 10 and ISC Class 11 have real indexed content today; other
// classes fall back to the "coming soon" empty state in SourceClassPicker.
// Each dataset is loaded via a dynamic import so visiting /resources/* never
// has to download every class's JSON (one of them is several MB) up front —
// only the active class's dataset is fetched, on demand.
const DATASET_LOADERS: Record<SourceId, Record<string, () => Promise<{ default: unknown }>>> = {
  cisce: {
    'icse-10': () => import('@/data/resources-cisce-icse-10.json'),
  },
  community: {
    'icse-10': () => import('@/data/resources-community-icse-10.json'),
    'isc-11': () => import('@/data/resources-community-isc-11.json'),
  },
};

const datasetCache = new Map<string, ResourceDataset>();

export function hasResourceDataset(source: SourceId, classSlug: string): boolean {
  return classSlug in DATASET_LOADERS[source];
}

export async function loadResourceDataset(source: SourceId, classSlug: string): Promise<ResourceDataset | undefined> {
  const key = `${source}/${classSlug}`;
  const cached = datasetCache.get(key);
  if (cached) return cached;
  const loader = DATASET_LOADERS[source][classSlug];
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
