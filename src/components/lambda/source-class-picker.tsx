import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, File, FileImage, FileSpreadsheet, FileText, Folder, MessageCircle, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classes, findSubjectMeta } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { useFuseSearch } from '@/hooks/use-fuse-search';
import { flattenFolderFiles, getFileKind, getGroupBadge, getGroupLabel, groupItems, hasResourceDataset, isFolderNode, isPremiumGroup, loadResourceManifest, loadResourceMisc, loadResourceSubject, type FileKind, type ResourceFolderNode, type ResourceItem, type ResourceManifest, type ResourceNode, type ResourceSubject } from '@/lib/resources-data';
import { ResourceWatch } from '@/components/lambda/resource-watch';
import { VirtualFileGrid } from '@/components/lambda/virtual-file-grid';

export type SourceId = 'cisce' | 'community';

interface SourceClassPickerProps {
  source: SourceId;
  classSlug?: string | undefined;
  subject?: string | undefined;
  title: string;
  desc: React.ReactNode;
}

const MISC_LABEL = 'Miscellaneous';

// Referentially stable key arrays for useFuseSearch — defining them inline
// at the call site would create a fresh array on every render and defeat
// the hook's memoization.
const SUBJECT_SEARCH_KEYS = ['subject'];
const FILE_SEARCH_KEYS = ['name'];

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
  const [expanded, setExpanded] = useState(isGeneral);
  const [overflows, setOverflows] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const hasEditorFolders = isGeneral && !!editorFolders?.length;

  useEffect(() => {
    if (isGeneral) return;
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
  }, [isGeneral, items.length]);

  const showCollapseUi = !isGeneral && overflows;
  // Large groups (hundreds of files) get virtualized once expanded, so the
  // DOM node count stays flat instead of mounting every FileCard at once.
  const VIRTUALIZE_THRESHOLD = 60;
  const shouldVirtualize = !hasEditorFolders && items.length > VIRTUALIZE_THRESHOLD && (expanded || !showCollapseUi);

  return (
    <section className={`doxx-notes resource-group${isGeneral ? ' resource-group-editors-choice' : isFeaturedGroup ? ' resource-group-featured-glow' : ''}`}>
      <div className="resource-group-head">
        <h2>
          <FileText size={18} /> {label}
          <span className="resource-count-badge">({items.length})</span>
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

export function SourceClassPicker({ source, classSlug, subject, title, desc }: SourceClassPickerProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [subjectQuery, setSubjectQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [activeFile, setActiveFile] = useState<ResourceItem | null>(null);
  const [activeFolderScope, setActiveFolderScope] = useState<ResourceFolderNode | null>(null);
  // Manifest = subject names + counts only (cheap, loads up front for the
  // card grid). The selected subject's actual file list (or misc) is a
  // separate, much smaller fetch — so picking "Mathematics" out of a
  // 6,000-file dataset only ever downloads Mathematics's own JSON shard.
  const [manifest, setManifest] = useState<ResourceManifest | undefined>(undefined);
  const [manifestLoading, setManifestLoading] = useState(false);
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
    loadResourceManifest(source, classSlug).then(data => {
      if (!cancelled) { setManifest(data); setManifestLoading(false); }
    });
    return () => { cancelled = true; };
  }, [source, classSlug, hasDataset]);

  // Subject fetch: only the active subject's (or misc's) own JSON shard —
  // split datasets never touch any other subject's files.
  useEffect(() => {
    if (!classSlug || !subject) { setSubjectEntry(undefined); setMiscItems(undefined); return; }
    let cancelled = false;
    setSubjectLoading(true);
    if (subject === MISC_LABEL) {
      loadResourceMisc(source, classSlug).then(items => {
        if (!cancelled) { setMiscItems(items); setSubjectEntry(undefined); setSubjectLoading(false); }
      });
    } else {
      loadResourceSubject(source, classSlug, subject).then(entry => {
        if (!cancelled) { setSubjectEntry(entry); setMiscItems(undefined); setSubjectLoading(false); }
      });
    }
    return () => { cancelled = true; };
  }, [source, classSlug, subject]);

  // Subject-grid search corpus: one card per subject plus a synthetic
  // "Miscellaneous" card when there are ungrouped files, so the fuzzy
  // search can match it by its displayed name too. Built from the
  // manifest's counts, not full file lists.
  const subjectCards = useMemo((): Array<{ subject: string; count: number }> => {
    if (!manifest) return [];
    const cards = manifest.subjects.map(s => ({ subject: s.subject, count: s.count }));
    if (manifest.miscCount > 0) cards.push({ subject: MISC_LABEL, count: manifest.miscCount });
    return cards;
  }, [manifest]);
  const filteredSubjectCards = useFuseSearch(subjectCards, SUBJECT_SEARCH_KEYS, subjectQuery);

  // Per-subject file search corpus: the subject's flat items plus every file
  // nested inside its Editor's Choice folders — a search must reach
  // folder-nested files too, not just the loose top-level ones.
  const subjectItems = subject === MISC_LABEL ? miscItems ?? [] : subjectEntry?.items ?? [];
  const editorFolders = subjectEntry?.editorFolders;
  const allSubjectFiles = useMemo(() => {
    const folderFiles = editorFolders?.flatMap(flattenFolderFiles) ?? [];
    return [...subjectItems, ...folderFiles];
  }, [subjectItems, editorFolders]);
  const filteredFiles = useFuseSearch(allSubjectFiles, FILE_SEARCH_KEYS, fileQuery);
  const isFileSearchActive = fileQuery.trim().length > 0;
  const groups = groupItems(subjectItems);
  const subjectDataReady = subject === MISC_LABEL ? miscItems !== undefined : subjectEntry !== undefined || (!subjectLoading && subject !== undefined);

  const disclaimer = source === 'community' ? (
    <div className="doxx-disclaimer">
      <div className="doxx-disclaimer-title"><MessageCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />About community resources</div>
      <p>{t('resources.community.disclaimerPrefix')} <a href="https://www.reddit.com/r/icse/" target="_blank" rel="noreferrer">r/ICSE</a> {t('resources.community.disclaimerMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> {t('resources.community.disclaimerSuffix')}</p>
    </div>
  ) : <p className="library-note">{t('resources.note')}</p>;

  // Class picked but no indexed dataset for it yet -> "coming soon" state.
  if (currentClass && !hasDataset) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{desc}</p>
      <p className="library-note">{currentClass.board} · Class {currentClass.grade}{subject ? ` · ${subject}` : ''}</p>
      <div className="empty-state"><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      {source === 'community' && disclaimer}
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
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <p className="library-note resource-total-count">{manifest.subjects.reduce((sum, s) => sum + s.count, 0) + manifest.miscCount} {t('resources.filesLabel')} {t('resources.total')}</p>
      <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchSubjects.label')} placeholder={t('resources.searchSubjects.placeholder')} value={subjectQuery} onChange={e => setSubjectQuery(e.target.value)} /></label>
      {filteredSubjectCards.length ? (
        <div className="doxx-cards">
          {filteredSubjectCards.map(s => {
            const isMisc = s.subject === MISC_LABEL;
            const isFeatured = s.subject === 'Featured';
            const meta = findSubjectMeta(s.subject);
            const Icon = isMisc ? Folder : isFeatured ? Sparkles : meta?.icon ?? FileText;
            return (
              <Link key={s.subject} to={sourcePath} search={{ class: classSlug, subject: s.subject }} className={`doxx-card${isMisc || isFeatured ? ' tone-rose' : meta ? ` tone-${meta.tone}` : ''}${isFeatured ? ' doxx-card-featured-glow' : ''}`}>
                <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
                <span className="doxx-card-title">{s.subject}</span>
                <span className="doxx-card-meta">{s.count} {t('resources.filesLabel')}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state"><h3>{t('resources.searchSubjects.empty.title')}</h3><p>{t('resources.searchSubjects.empty.text')}</p></div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  // Subject picked -> file list first; clicking a file opens the player view.
  if (currentClass && manifest && subject) {
    // Still fetching the subject's own JSON shard -> lightweight loading state.
    if (!subjectDataReady) {
      return <main className="container content-page">
        <Link to={sourcePath} search={{ class: classSlug }} className="back-link"><ArrowLeft size={15} /> {t('hub.backToSubjects')}</Link>
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
        <button type="button" className="back-link" onClick={() => { setActiveFile(null); setActiveFolderScope(null); }}><ArrowLeft size={15} /> {t('doxx.back')}</button>
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <ResourceWatch groups={sidebarGroups} active={activeFile} onSelect={item => setActiveFile(item)} />
        {source === 'community' && disclaimer}
      </main>;
    }

    return <main className="container content-page">
      <Link to={sourcePath} search={{ class: classSlug }} className="back-link"><ArrowLeft size={15} /> {t('hub.backToSubjects')}</Link>
      <h1>{subject}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
      <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchFiles.label')} placeholder={t('resources.searchFiles.placeholder')} value={fileQuery} onChange={e => setFileQuery(e.target.value)} /></label>
      {isFileSearchActive ? (
        filteredFiles.length ? (
          filteredFiles.length > 60 ? (
            <VirtualFileGrid
              className="resource-file-grid-virtual resource-search-results"
              items={filteredFiles}
              renderItem={item => <FileCard key={item.id} item={item} onClick={() => { setActiveFolderScope(null); setActiveFile(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
            />
          ) : (
            <div className="resource-file-grid resource-search-results">
              {filteredFiles.map(item => (
                <FileCard key={item.id} item={item} onClick={() => { setActiveFolderScope(null); setActiveFile(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state"><h3>{t('resources.searchFiles.empty.title')}</h3><p>{t('resources.searchFiles.empty.text')}</p></div>
        )
      ) : subjectItems.length || editorFolders?.length ? (
        groups.map(section => (
          <GroupSection
            key={section.group}
            group={section.group}
            items={section.items}
            editorFolders={section.group.toLowerCase() === 'general' ? editorFolders : undefined}
            onPick={(item, folderScope) => {
              setActiveFolderScope(folderScope ?? null);
              setActiveFile(item);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ))
      ) : (
        <div className="empty-state"><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  const filtered = classes.filter(c => `${c.board} class ${c.grade} ${c.label}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="container content-page">
    <Link to="/resources" className="back-link"><ArrowLeft size={15} /> {t('resources.backToSources')}</Link>
    <h1>{title}<span className="text-primary">.</span></h1>
    <p className="page-intro">{desc}</p>
    <label className="search-field resource-search"><Search size={18} /><input aria-label={t('resources.searchLabel')} placeholder={t('resources.searchPlaceholder')} value={query} onChange={e => setQuery(e.target.value)} /></label>
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
    {!filtered.length && <div className="empty-state"><h3>{t('resources.empty.title')}</h3><p>{t('resources.empty.text')}</p></div>}
    {disclaimer}
  </main>;
}
