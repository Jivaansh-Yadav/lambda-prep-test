import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronDown, ChevronUp, File, FileImage, FileSpreadsheet, FileText, Folder, MessageCircle, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classes, findSubjectMeta, getSiteOrigin, subjectMatchesStream } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { useFuseSearch } from '@/hooks/use-fuse-search';
import { flattenFolderFiles, findItemInSubject, getFileKind, getGroupBadge, getGroupLabel, groupItems, hasResourceDataset, isFolderNode, isPremiumGroup, loadAllClassFiles, loadAllSourceFiles, loadResourceManifest, loadResourceMisc, loadResourceSubject, type FileKind, type ResourceFolderNode, type ResourceItem, type ResourceManifest, type ResourceNode, type ResourceSearchHit, type ResourceSubject } from '@/lib/resources-data';
import { ResourceWatch } from '@/components/lambda/resource-watch';
import { VirtualFileGrid } from '@/components/lambda/virtual-file-grid';
import { StreamTabs } from '@/components/lambda/stream-tabs';
import { Button } from '@/components/ui/button';

export type SourceId = 'cisce' | 'community';

interface SourceClassPickerProps {
  source: SourceId;
  classSlug?: string | undefined;
  subject?: string | undefined;
  /** Google Drive file id of the resource currently deep-linked via the
   * `file` search param, if any — lets a shared link reopen the exact file
   * instead of just the subject grid. */
  file?: string | undefined;
  /** Current ISC stream filter ('Science' | 'Commerce' | 'Humanities'),
   * undefined/`'All'` meaning no filter. Only shown once a class whose
   * board is ISC is selected, mirroring the class hub's stream tabs. */
  stream?: string | undefined;
  /** Called when the stream filter changes, so the host route can keep it
   * in the `?stream=` search param (and therefore the shareable/back-nav
   * URL) in sync. */
  onStreamChange?: (stream: string) => void;
  /** Called whenever the viewer opens/closes a file, so the host route can
   * keep the `file` search param (and therefore the shareable URL) in sync.
   * Passing `undefined` clears the param. */
  onFileChange?: (fileId: string | undefined) => void;
  title: string;
  desc: React.ReactNode;
}

const MISC_LABEL = 'Miscellaneous';

// Referentially stable key arrays for useFuseSearch — defining them inline
// at the call site would create a fresh array on every render and defeat
// the hook's memoization.
const SUBJECT_SEARCH_KEYS = ['subject'];
const FILE_SEARCH_KEYS = ['name'];
// Broad (cross-subject / cross-class) file search corpus key — ResourceSearchHit
// wraps the file under `item`, so Fuse needs the nested dot-path.
const SOURCE_HIT_SEARCH_KEYS = ['item.name'];

const FILE_KIND_META: Record<FileKind, { icon: typeof FileText; tone: string; label: string }> = {
  pdf: { icon: FileText, tone: 'rose', label: 'PDF' },
  docx: { icon: File, tone: 'blue', label: 'DOCX' },
  xlsx: { icon: FileSpreadsheet, tone: 'green', label: 'XLSX' },
  pptx: { icon: File, tone: 'amber', label: 'PPTX' },
  image: { icon: FileImage, tone: 'purple', label: 'IMG' },
  other: { icon: FileText, tone: 'teal', label: 'FILE' },
};

function FileCard({ item, onClick }: { item: ResourceItem; onClick: () => void }) {
  const kind = getFileKind(item.name);
  const meta = FILE_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <button type="button" className={`resource-file-card tone-${meta.tone}`} onClick={onClick}>
      <span className="resource-file-icon"><Icon size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">{item.name}</span>
      <span className="resource-file-type">{meta.label}</span>
    </button>
  );
}

/** Same card as FileCard but for a broad (cross-subject/cross-class) search
 * hit — shows which subject (and, for a cross-class search, which class)
 * the file lives in, since that context is no longer implied by the page
 * the user is on. Navigates straight into that subject's file viewer with
 * the file pre-opened via the `file` search param. */
function HitFileCard({ hit, sourcePath, classLabel, stream }: { hit: ResourceSearchHit; sourcePath: string; classLabel?: string | undefined; stream?: string | undefined }) {
  const kind = getFileKind(hit.item.name);
  const meta = FILE_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <Link
      to={sourcePath}
      search={{ class: hit.classSlug, subject: hit.subject, file: hit.item.id, stream }}
      className={`resource-file-card tone-${meta.tone}`}
    >
      <span className="resource-file-icon"><Icon size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">{hit.item.name}</span>
      <span className="resource-file-hit-meta">
        <span className="resource-file-type">{meta.label}</span>
        <span className="resource-file-hit-subject">{classLabel ? `${classLabel} · ${hit.subject}` : hit.subject}</span>
      </span>
    </Link>
  );
}

function countFolderFiles(folder: ResourceFolderNode): number {
  let n = 0;
  for (const c of folder.children) {
    n += isFolderNode(c) ? countFolderFiles(c) : 1;
  }
  return n;
}

function FolderCard({ folder, onClick }: { folder: ResourceFolderNode; onClick: () => void }) {
  return (
    <button type="button" className="resource-file-card resource-folder-card tone-amber" onClick={onClick}>
      <span className="resource-file-icon"><Folder size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">{folder.name}</span>
      <span className="resource-file-type">{countFolderFiles(folder)} FILES</span>
    </button>
  );
}

/** Recursive folder navigator used inside the Editor's Choice group: shows
 * folder cards (priority) + files at the current level, with a back button
 * and slide animation when drilling in/out of folders. */
function EditorChoiceNav({ folders, items, onPick }: {
  folders: ResourceFolderNode[];
  items: ResourceItem[];
  onPick: (item: ResourceItem, folderScope: ResourceFolderNode | null) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState<ResourceFolderNode[]>([]);
  const [direction, setDirection] = useState<'in' | 'out'>('in');

  const current = path[path.length - 1];
  const currentFolders = current ? current.children.filter(isFolderNode) : folders;
  const currentFiles: ResourceItem[] = current
    ? current.children.filter((c): c is ResourceItem => !isFolderNode(c))
    : items;

  const openFolder = (folder: ResourceFolderNode) => {
    setDirection('in');
    setPath(p => [...p, folder]);
  };
  const goBack = () => {
    setDirection('out');
    setPath(p => p.slice(0, -1));
  };

  return (
    <div className="resource-editor-nav">
      {path.length > 0 && (
        <div className="resource-editor-crumbs">
          <button type="button" className="resource-editor-back" onClick={goBack}>
            <ArrowLeft size={14} /> {t('resources.editorChoice.back')}
          </button>
          <span className="resource-editor-crumb-trail">{path.map(f => f.name).join(' / ')}</span>
        </div>
      )}
      <div key={path.map(f => f.name).join('/')} className={`resource-file-grid resource-editor-grid slide-${direction}`}>
        {currentFolders.map(folder => (
          <FolderCard key={folder.name} folder={folder} onClick={() => openFolder(folder)} />
        ))}
        {currentFiles.map(item => (
          <FileCard key={item.id} item={item} onClick={() => onPick(item, current ?? null)} />
        ))}
      </div>
    </div>
  );
}

function GroupSection({ group, items, editorFolders, onPick }: {
  group: string;
  items: ResourceItem[];
  editorFolders?: ResourceFolderNode[] | undefined;
  onPick: (item: ResourceItem, folderScope?: ResourceFolderNode | null) => void;
}) {
  const { t } = useI18n();
  const label = getGroupLabel(group);
  const badge = getGroupBadge(group);
  const isGeneral = group.toLowerCase() === 'general';
  const isFeaturedGroup = group.toLowerCase() === 'featured';
  const premium = isPremiumGroup(group);
  const hasEditorFolders = !!editorFolders?.length;
  const [expanded, setExpanded] = useState(isGeneral || hasEditorFolders);
  const [overflows, setOverflows] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // A folder-nav group (CISCE's official APF/CFQs/PYQs/SQP/Syllabus tree, or
  // Community's curated Julius Caesar-style folders under "General") has no
  // loose `items` of its own — the file count that matters is every file
  // nested inside the folder tree instead.
  const displayCount = hasEditorFolders ? editorFolders!.reduce((n, f) => n + flattenFolderFiles(f).length, 0) : items.length;

  useEffect(() => {
    if (isGeneral || hasEditorFolders) return;
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const cap = window.innerWidth <= 800 ? 580 : 278;
      setOverflows(el.scrollHeight > cap + 4);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [isGeneral, hasEditorFolders, items.length]);

  const showCollapseUi = !isGeneral && !hasEditorFolders && overflows;
  // Large groups (hundreds of files) get virtualized only once the creator
  // actually expands them, so the collapsed state still goes through the
  // same capped grid as every other group — with its gap and "View all"
  // button — instead of jumping straight into an unbounded scroller with
  // no spacing or expand/collapse affordance. Gating on `expanded` also
  // keeps `gridRef` mounted while collapsed, which is what measures
  // `overflows` via ResizeObserver in the first place.
  const VIRTUALIZE_THRESHOLD = 60;
  const shouldVirtualize = !hasEditorFolders && items.length > VIRTUALIZE_THRESHOLD && expanded;

  return (
    <section className={`doxx-notes resource-group${isGeneral || hasEditorFolders ? ' resource-group-editors-choice' : isFeaturedGroup ? ' resource-group-featured-glow' : ''}`}>
      <div className="resource-group-head">
        <h2>
          <FileText size={18} /> {label}
          <span className="resource-count-badge">({displayCount})</span>
          {badge && (
            <span className={`resource-group-badge${premium ? ' is-premium' : ''}`} tabIndex={0}>
              <span className="resource-group-badge-fill">{badge}</span>
              {premium && (
                <span className="resource-group-tooltip" role="tooltip">
                  {t('resources.badge.editorsChoiceTooltip')}
                </span>
              )}
            </span>
          )}
        </h2>
      </div>
      {hasEditorFolders ? (
        <EditorChoiceNav folders={editorFolders!} items={items} onPick={onPick} />
      ) : shouldVirtualize ? (
        <VirtualFileGrid
          className="resource-file-grid-virtual"
          items={items}
          renderItem={item => <FileCard key={item.id} item={item} onClick={() => onPick(item)} />}
        />
      ) : (
        <div className={`resource-file-grid-wrap${expanded || !showCollapseUi ? ' is-expanded' : ''}`}>
          <div className="resource-file-grid" ref={gridRef}>
            {items.map(item => (
              <FileCard key={item.id} item={item} onClick={() => onPick(item)} />
            ))}
          </div>
          {showCollapseUi && !expanded && (
            <div className="resource-group-fade">
              <button type="button" className="resource-group-viewall" onClick={() => setExpanded(true)}>
                {t('resources.viewAll')} <span className="resource-count-badge">({items.length})</span> <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      {showCollapseUi && expanded && !shouldVirtualize && (
        <button type="button" className="resource-group-collapse" onClick={() => setExpanded(false)}>
          {t('resources.showLess')} <ChevronUp size={16} />
        </button>
      )}
    </section>
  );
}

export function SourceClassPicker({ source, classSlug, subject, file, stream, onStreamChange, onFileChange, title, desc }: SourceClassPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [subjectQuery, setSubjectQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [activeFile, setActiveFile] = useState<ResourceItem | null>(null);
  const [activeFolderScope, setActiveFolderScope] = useState<ResourceFolderNode | null>(null);
  // Broad, cross-scope file search state. At the top level (no class picked
  // yet) a query searches every file indexed for this source (CISCE or
  // Community, across every class); once a class is picked but no subject
  // yet, it's confined to that one class's files only. Both corpora are
  // fetched lazily (only once the viewer actually types something) and
  // cached by resources-data.ts, so landing on the page never pays for them.
  const [sourceHits, setSourceHits] = useState<ResourceSearchHit[] | undefined>(undefined);
  const [sourceHitsLoading, setSourceHitsLoading] = useState(false);
  const [classHits, setClassHits] = useState<ResourceSearchHit[] | undefined>(undefined);
  const [classHitsLoading, setClassHitsLoading] = useState(false);
  // Manifest = subject names + counts only (cheap, loads up front for the
  // card grid). The selected subject's actual file list (or misc) is a
  // separate, much smaller fetch — so picking "Mathematics" out of a
  // 6,000-file dataset only ever downloads Mathematics's own JSON shard.
  const [manifest, setManifest] = useState<ResourceManifest | undefined>(undefined);
  const [manifestLoading, setManifestLoading] = useState(false);
  // A rejected loader (most often a stale content-hashed chunk after a
  // redeploy) used to leave the skeleton spinning forever, because
  // `*Loading` was only cleared in `.then()`. These flags let us render a
  // real error state with a way out instead.
  const [manifestError, setManifestError] = useState(false);
  const [subjectError, setSubjectError] = useState(false);
  const [subjectEntry, setSubjectEntry] = useState<ResourceSubject | undefined>(undefined);
  const [miscItems, setMiscItems] = useState<ResourceItem[] | undefined>(undefined);
  const [subjectLoading, setSubjectLoading] = useState(false);
  useEffect(() => {
    setActiveFile(null);
    setActiveFolderScope(null);
  }, [classSlug, subject]);
  useEffect(() => {
    setSubjectQuery('');
  }, [classSlug]);
  useEffect(() => {
    setFileQuery('');
  }, [classSlug, subject]);
  const sourcePath = source === 'cisce' ? '/resources/cisce' : '/resources/community';
  const currentClass = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const hasDataset = classSlug ? hasResourceDataset(source, classSlug) : false;

  // Manifest fetch: happens once per class, independent of which subject
  // (if any) is selected, so the subject-card grid can render immediately.
  useEffect(() => {
    if (!classSlug || !hasDataset) { setManifest(undefined); return; }
    let cancelled = false;
    setManifestLoading(true);
    setManifestError(false);
    loadResourceManifest(source, classSlug).then(data => {
      if (!cancelled) { setManifest(data); setManifestLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load manifest', source, classSlug, error);
      setManifestLoading(false);
      setManifestError(true);
    });
    return () => { cancelled = true; };
  }, [source, classSlug, hasDataset]);

  // Subject fetch: only the active subject's (or misc's) own JSON shard —
  // split datasets never touch any other subject's files.
  useEffect(() => {
    if (!classSlug || !subject) { setSubjectEntry(undefined); setMiscItems(undefined); return; }
    let cancelled = false;
    setSubjectLoading(true);
    setSubjectError(false);
    const fail = (error: unknown) => {
      if (cancelled) return;
      console.error('[resources] failed to load subject data', source, classSlug, subject, error);
      setSubjectLoading(false);
      setSubjectError(true);
    };
    if (subject === MISC_LABEL) {
      loadResourceMisc(source, classSlug).then(items => {
        if (!cancelled) { setMiscItems(items); setSubjectEntry(undefined); setSubjectLoading(false); }
      }).catch(fail);
    } else {
      loadResourceSubject(source, classSlug, subject).then(entry => {
        if (!cancelled) { setSubjectEntry(entry); setMiscItems(undefined); setSubjectLoading(false); }
      }).catch(fail);
    }
    return () => { cancelled = true; };
  }, [source, classSlug, subject]);

  // Broad cross-class search (top-level "choose a class" page): fetched
  // lazily — only once the viewer actually types a query — since it means
  // loading every subject's file list across every indexed class for this
  // source. Cached in resources-data.ts, so retyping a cleared query or
  // revisiting this page doesn't refetch.
  const trimmedQuery = query.trim();
  useEffect(() => {
    if (classSlug || !trimmedQuery) return;
    let cancelled = false;
    setSourceHitsLoading(true);
    loadAllSourceFiles(source, classes.map(c => c.slug)).then(hits => {
      if (!cancelled) { setSourceHits(hits); setSourceHitsLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load source-wide file search index', source, error);
      setSourceHitsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- classSlug is a presence check only
  }, [source, !!classSlug, !!trimmedQuery]);

  // Broad cross-subject search (class's own subject grid): same lazy-load,
  // cheaper since it's confined to one class's files.
  const trimmedSubjectQuery = subjectQuery.trim();
  useEffect(() => {
    if (!classSlug || subject || !hasDataset || !trimmedSubjectQuery) return;
    let cancelled = false;
    setClassHitsLoading(true);
    loadAllClassFiles(source, classSlug).then(hits => {
      if (!cancelled) { setClassHits(hits); setClassHitsLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load class-wide file search index', source, classSlug, error);
      setClassHitsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subject/hasDataset are presence checks only
  }, [source, classSlug, !!subject, hasDataset, !!trimmedSubjectQuery]);
  // Reset the cached hit lists when the class changes, so switching class
  // doesn't show the previous class's broad search results while the new
  // ones are still loading.
  useEffect(() => {
    setClassHits(undefined);
  }, [classSlug]);

  // Subject-grid search corpus: one card per subject plus a synthetic
  // "Miscellaneous" card when there are ungrouped files, so the fuzzy
  // search can match it by its displayed name too. Built from the
  // manifest's counts, not full file lists. For ISC classes, also honors
  // the Science/Commerce/Humanities stream filter — mirroring the class
  // hub's stream tabs — but "Featured"/"Miscellaneous" are mixed-subject
  // buckets with no single stream, so they stay visible regardless.
  const activeStream = currentClass?.board === 'ISC' ? (stream ?? 'All') : 'All';
  const subjectCards = useMemo((): Array<{ subject: string; count: number }> => {
    if (!manifest) return [];
    const cards = manifest.subjects
      .filter(s => s.subject === MISC_LABEL || s.subject === 'Featured' || subjectMatchesStream(s.subject, activeStream))
      .map(s => ({ subject: s.subject, count: s.count }));
    if (manifest.miscCount > 0) cards.push({ subject: MISC_LABEL, count: manifest.miscCount });
    // Keep card order deterministic and independent of the underlying
    // dataset's own subject order, which can silently shift between Google
    // Drive re-crawls (folder listing order from the Drive API isn't
    // guaranteed stable run-to-run). Without this, a routine "Update
    // resource datasets" re-crawl could reshuffle the whole grid for
    // anyone browsing once the regenerated dataset ships — "Featured"
    // always leads, "Miscellaneous" always trails, everything else sorts
    // alphabetically in between, so the grid's layout stays stable no
    // matter what order the crawl happened to return folders in.
    const priority = (subject: string) => (subject === 'Featured' ? 0 : subject === MISC_LABEL ? 2 : 1);
    return [...cards].sort((a, b) => {
      const pa = priority(a.subject);
      const pb = priority(b.subject);
      if (pa !== pb) return pa - pb;
      return pa === 1 ? a.subject.localeCompare(b.subject) : 0;
    });
  }, [manifest, activeStream]);
  const filteredSubjectCards = useFuseSearch(subjectCards, SUBJECT_SEARCH_KEYS, subjectQuery);

  // Broad search results: the cross-class ("choose a class" page) and
  // cross-subject (subject-grid page) hit lists, fuzzy-filtered the same
  // way as every other search box here but against a corpus that only
  // exists once the viewer has actually typed something (see the lazy
  // loader effects above).
  const filteredSourceHits = useFuseSearch(sourceHits ?? [], SOURCE_HIT_SEARCH_KEYS, trimmedQuery ? query : '', 130);
  const isSourceSearchActive = trimmedQuery.length > 0;
  const filteredClassHits = useFuseSearch(classHits ?? [], SOURCE_HIT_SEARCH_KEYS, trimmedSubjectQuery ? subjectQuery : '', 130);
  const isClassSearchActive = trimmedSubjectQuery.length > 0;

  // Per-subject file search corpus: the subject's flat items plus every file
  // nested inside its Editor's Choice folders — a search must reach
  // folder-nested files too, not just the loose top-level ones.
  const subjectItems = subject === MISC_LABEL ? miscItems ?? [] : subjectEntry?.items ?? [];
  const editorFolders = subjectEntry?.editorFolders;
  const allSubjectFiles = useMemo(() => {
    const folderFiles = editorFolders?.flatMap(flattenFolderFiles) ?? [];
    return [...subjectItems, ...folderFiles];
  }, [subjectItems, editorFolders]);
  const filteredFiles = useFuseSearch(allSubjectFiles, FILE_SEARCH_KEYS, fileQuery, 50);
  const isFileSearchActive = fileQuery.trim().length > 0;
  const groups = groupItems(subjectItems);
  // CISCE's official-resources folder tree (APF/CFQs/PYQs/SQP/Syllabus ->
  // year -> files) and Community's curated Editor's Choice folders
  // (Julius Caesar, Treasure Chest, ...) both live in `editorFolders`, but
  // attach to different named groups. CISCE subjects have no loose items
  // at all — only the folder tree — so there's no existing group entry to
  // merge into; create a synthetic empty-items one for it.
  const editorFoldersGroup = subjectEntry?.editorFoldersGroup ?? 'General';
  const displayGroups = useMemo(() => {
    if (!editorFolders?.length) return groups;
    const hasMatch = groups.some(g => g.group.toLowerCase() === editorFoldersGroup.toLowerCase());
    return hasMatch ? groups : [...groups, { group: editorFoldersGroup, items: [] }];
  }, [groups, editorFolders, editorFoldersGroup]);
  const subjectDataReady = subject === MISC_LABEL ? miscItems !== undefined : subjectEntry !== undefined || (!subjectLoading && subject !== undefined);

  // Deep-link support: once the subject's files are loaded, resolve the
  // `?file=<driveId>` search param (if any) against them and open that
  // file automatically — this is what makes a shared resource link land
  // directly on the file instead of just the subject grid. Only runs when
  // there's no file already open, so a later in-page file click (which
  // clears/updates the param itself) doesn't get fought by this effect.
  useEffect(() => {
    if (!file || activeFile || !subjectDataReady) return;
    const resolved = findItemInSubject(subjectItems, editorFolders, file);
    if (resolved) {
      setActiveFile(resolved.item);
      setActiveFolderScope(resolved.folderScope);
    }
  }, [file, activeFile, subjectDataReady, subjectItems, editorFolders]);

  const openFile = (item: ResourceItem, folderScope: ResourceFolderNode | null = null) => {
    setActiveFolderScope(folderScope);
    setActiveFile(item);
    onFileChange?.(item.id);
  };
  const closeFile = () => {
    setActiveFile(null);
    setActiveFolderScope(null);
    onFileChange?.(undefined);
  };

  const disclaimer = source === 'community' ? (
    <div className="doxx-disclaimer">
      <div className="doxx-disclaimer-title"><MessageCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />About community resources</div>
      <p>{t('resources.community.disclaimerPrefix')} <a href="https://www.reddit.com/r/icse/" target="_blank" rel="noreferrer">r/ICSE</a> and <a href="https://www.reddit.com/r/ISCNERDS/" target="_blank" rel="noreferrer">r/ISCNERDS</a> {t('resources.community.disclaimerMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> and <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ISCcord</a> {t('resources.community.disclaimerSuffix')}</p>
    </div>
  ) : <p className="library-note">{t('resources.note')}</p>;

  // Class picked but no indexed dataset for it yet -> "coming soon" state.
  if (currentClass && !hasDataset) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{desc}</p>
      <p className="library-note">{currentClass.board} · Class {currentClass.grade}{subject ? ` · ${subject}` : ''}</p>
      <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      {source === 'community' && disclaimer}
    </main>;
  }

  // Dataset fetch failed (e.g. a stale chunk after a redeploy) -> say so and
  // offer a way out instead of leaving the skeletons spinning forever.
  if (currentClass && hasDataset && manifestError) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <div className="empty-state">
        <RefreshCw size={28} />
        <h3>{t('resources.loadError.title')}</h3>
        <p>{t('resources.loadError.text')}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>{t('resources.loadError.refresh')}</Button>
      </div>
    </main>;
  }

  // Dataset is being fetched (code-split per class) -> lightweight loading state.
  if (currentClass && hasDataset && !manifest) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <div className="doxx-cards" aria-busy={manifestLoading}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
      </div>
    </main>;
  }

  // Class + manifest present, but no subject picked yet -> subject card grid.
  if (currentClass && manifest && !subject) {
    // Manifest has literally nothing yet (e.g. freshly added class) vs. the
    // stream filter narrowing an otherwise-populated manifest down to zero
    // matches — these need different empty-state copy, so the check has to
    // happen before the stream filter above has had a chance to hide
    // everything.
    const manifestIsEmpty = !manifest.subjects.length && !manifest.miscCount;
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <div className="content-header">
        <h1>{title}<span className="text-primary">.</span></h1>
        <div className="content-header-row">
          <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
          {!!subjectCards.length && (
            <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchClass.label')} placeholder={t('resources.searchClass.placeholder')} value={subjectQuery} onChange={e => setSubjectQuery(e.target.value)} /></label>
          )}
        </div>
      </div>
      {!manifestIsEmpty && currentClass.board === 'ISC' && (
        <div className="resource-stream-tabs"><StreamTabs stream={activeStream} onChange={next => onStreamChange?.(next)} /></div>
      )}
      {!!subjectCards.length && <p className="library-note resource-total-count">{subjectCards.reduce((sum, s) => sum + s.count, 0)} {t('resources.filesLabel')} {t('resources.total')}</p>}
      {isClassSearchActive ? (
        <>
          <p className="library-note resource-search-count">{t('resources.search.resultsFor').replace('{query}', trimmedSubjectQuery).replace('{n}', classHitsLoading && !classHits ? '…' : String(filteredClassHits.length))}</p>
          {classHitsLoading && !classHits ? (
            <div className="resource-file-grid" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
            </div>
          ) : filteredClassHits.length ? (
            filteredClassHits.length > 60 ? (
              <VirtualFileGrid
                className="resource-file-grid-virtual resource-search-results"
                items={filteredClassHits}
                renderItem={hit => <HitFileCard key={hit.item.id} hit={hit} sourcePath={sourcePath} stream={stream} />}
              />
            ) : (
              <div className="resource-file-grid resource-search-results">
                {filteredClassHits.map(hit => <HitFileCard key={hit.item.id} hit={hit} sourcePath={sourcePath} stream={stream} />)}
              </div>
            )
          ) : (
            <div className="empty-state"><Search /><h3>{t('resources.searchClass.empty.title')}</h3><p>{t('resources.searchClass.empty.text')}</p></div>
          )}
        </>
      ) : manifestIsEmpty ? (
        // Dataset exists for this class but its manifest lists zero
        // subjects (e.g. freshly added class awaiting content) — same
        // "being prepared" message as a class with no dataset at all,
        // not the "no search results" copy below.
        <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      ) : !subjectCards.length ? (
        // The manifest has subjects, but none of them belong to the
        // selected stream — same "clear filters" framing as the class
        // hub's own stream tabs use.
        <div className="empty-state"><BookOpen /><h3>{t('hub.empty.title')}</h3><p>{t('hub.empty.text')}</p></div>
      ) : filteredSubjectCards.length ? (
        <div className="doxx-cards">
          {filteredSubjectCards.map(s => {
            const isMisc = s.subject === MISC_LABEL;
            const isFeatured = s.subject === 'Featured';
            const meta = findSubjectMeta(s.subject);
            const Icon = isMisc ? Folder : isFeatured ? Sparkles : meta?.icon ?? FileText;
            return (
              <Link key={s.subject} to={sourcePath} search={{ class: classSlug, subject: s.subject, stream }} className={`doxx-card${isMisc || isFeatured ? ' tone-rose' : meta ? ` tone-${meta.tone}` : ''}${isFeatured ? ' doxx-card-featured-glow' : ''}`}>
                <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
                <span className="doxx-card-title">{s.subject}</span>
                <span className="doxx-card-meta">{s.count} {t('resources.filesLabel')}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state"><Search /><h3>{t('resources.searchSubjects.empty.title')}</h3><p>{t('resources.searchSubjects.empty.text')}</p></div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  // Subject picked -> file list first; clicking a file opens the player view.
  if (currentClass && manifest && subject) {
    // Subject shard failed to load -> same treatment as the manifest error.
    if (subjectError) {
      return <main className="container content-page">
        <Link to={sourcePath} search={{ class: classSlug, stream }} className="back-link"><ArrowLeft size={15} /> {t('hub.backToSubjects')}</Link>
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <div className="empty-state">
          <RefreshCw size={28} />
          <h3>{t('resources.loadError.title')}</h3>
          <p>{t('resources.loadError.text')}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>{t('resources.loadError.refresh')}</Button>
        </div>
      </main>;
    }

    // Still fetching the subject's own JSON shard -> lightweight loading state.
    if (!subjectDataReady) {
      return <main className="container content-page">
        <Link to={sourcePath} search={{ class: classSlug, stream }} className="back-link"><ArrowLeft size={15} /> {t('hub.backToSubjects')}</Link>
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <div className="resource-file-grid" aria-busy={subjectLoading}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
        </div>
      </main>;
    }

    // `subjectItems`/`editorFolders`/`groups` are computed earlier in the
    // component (hoisted there to respect the Rules of Hooks, since they
    // feed useFuseSearch); `groups` is irrelevant while a file search is
    // active, since the search view below renders `filteredFiles` as a flat
    // list instead of the grouped sections.
    // When viewing a file opened from inside a folder-card (e.g. "Act III,
    // Scene I - Brief.pdf" inside the "Julius Caesar" > "ACT III" > "SCENE I"
    // folder), the sidebar must show only that folder's own files — not the
    // whole Editor's Choice group / subject.
    const sidebarGroups = activeFolderScope
      ? [{ group: activeFolderScope.name, items: activeFolderScope.children.filter((c): c is ResourceItem => !isFolderNode(c)) }]
      : groups;

    if (activeFile) {
      return <main className="container content-page">
        <button type="button" className="back-link" onClick={closeFile}><ArrowLeft size={15} /> {t('doxx.back')}</button>
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <ResourceWatch
          groups={sidebarGroups}
          active={activeFile}
          onSelect={item => openFile(item)}
          shareUrl={`${getSiteOrigin()}${sourcePath}?class=${encodeURIComponent(classSlug ?? '')}&subject=${encodeURIComponent(subject ?? '')}&file=${encodeURIComponent(activeFile.id)}`}
        />
        {source === 'community' && disclaimer}
      </main>;
    }

    return <main className="container content-page">
      <Link to={sourcePath} search={{ class: classSlug, stream }} className="back-link"><ArrowLeft size={15} /> {t('hub.backToSubjects')}</Link>
      <div className="content-header">
        <h1>{subject}<span className="text-primary">.</span></h1>
        <div className="content-header-row">
          <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
          <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchFiles.label')} placeholder={t('resources.searchFiles.placeholder')} value={fileQuery} onChange={e => setFileQuery(e.target.value)} /></label>
        </div>
      </div>
      {isFileSearchActive ? (
        <>
          <p className="library-note resource-search-count">{t('resources.search.resultsFor').replace('{query}', fileQuery.trim()).replace('{n}', String(filteredFiles.length))}</p>
          {filteredFiles.length ? (
            filteredFiles.length > 60 ? (
              <VirtualFileGrid
                className="resource-file-grid-virtual resource-search-results"
                items={filteredFiles}
                renderItem={item => <FileCard key={item.id} item={item} onClick={() => { openFile(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
              />
            ) : (
              <div className="resource-file-grid resource-search-results">
                {filteredFiles.map(item => (
                  <FileCard key={item.id} item={item} onClick={() => { openFile(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
                ))}
              </div>
            )
          ) : (
            <div className="empty-state"><Search /><h3>{t('resources.searchFiles.empty.title')}</h3><p>{t('resources.searchFiles.empty.text')}</p></div>
          )}
        </>
      ) : subjectItems.length || editorFolders?.length ? (
        displayGroups.map(section => (
          <GroupSection
            key={section.group}
            group={section.group}
            items={section.items}
            editorFolders={section.group.toLowerCase() === editorFoldersGroup.toLowerCase() ? editorFolders : undefined}
            onPick={(item, folderScope) => {
              openFile(item, folderScope ?? null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ))
      ) : (
        <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  const filtered = classes.filter(c => `${c.board} class ${c.grade} ${c.label}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="container content-page">
    <Link to="/resources" className="back-link"><ArrowLeft size={15} /> {t('resources.backToSources')}</Link>
    <div className="content-header">
      <h1>{title}<span className="text-primary">.</span></h1>
      <div className="content-header-row">
        <p className="page-intro">{desc}</p>
        <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchSource.label')} placeholder={t('resources.searchSource.placeholder')} value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
    </div>
    {isSourceSearchActive ? (
      <>
        <p className="library-note resource-search-count">{t('resources.search.resultsFor').replace('{query}', trimmedQuery).replace('{n}', sourceHitsLoading && !sourceHits ? '…' : String(filteredSourceHits.length))}</p>
        {sourceHitsLoading && !sourceHits ? (
          <div className="resource-file-grid" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
          </div>
        ) : filteredSourceHits.length ? (
          filteredSourceHits.length > 60 ? (
            <VirtualFileGrid
              className="resource-file-grid-virtual resource-search-results"
              items={filteredSourceHits}
              renderItem={hit => {
                const cls = classes.find(c => c.slug === hit.classSlug);
                return <HitFileCard key={hit.item.id} hit={hit} sourcePath={sourcePath} classLabel={cls ? `Class ${cls.grade}` : undefined} />;
              }}
            />
          ) : (
            <div className="resource-file-grid resource-search-results">
              {filteredSourceHits.map(hit => {
                const cls = classes.find(c => c.slug === hit.classSlug);
                return <HitFileCard key={hit.item.id} hit={hit} sourcePath={sourcePath} classLabel={cls ? `Class ${cls.grade}` : undefined} />;
              })}
            </div>
          )
        ) : (
          <div className="empty-state"><Search /><h3>{t('resources.searchSource.empty.title')}</h3><p>{t('resources.searchSource.empty.text')}</p></div>
        )}
      </>
    ) : (
      <div className="class-grid">
        {filtered.map(c => (
          <Link key={c.slug} to={sourcePath} search={{ class: c.slug, subject }} className={`class-card tone-${c.tone}`}>
            <span className="subject-icon"><c.icon /></span>
            <h3>Class {c.grade}</h3>
            <span className="class-label">{c.label}</span>
            <p>{c.description}</p>
            <div className="card-bottom">{t('class.browseSubjects')} <ArrowUpRight size={18} /></div>
          </Link>
        ))}
      </div>
    )}
    {!isSourceSearchActive && !filtered.length && <div className="empty-state"><Search /><h3>{t('resources.empty.title')}</h3><p>{t('resources.empty.text')}</p></div>}
    {disclaimer}
  </main>;
}
