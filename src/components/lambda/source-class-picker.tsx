import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, File, FileImage, FileSpreadsheet, FileText, Folder, MessageCircle, Search, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { classes, findSubjectMeta } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { findFolderPathForFile, getFileKind, getGroupBadge, getGroupLabel, groupItems, hasResourceDataset, isFolderNode, isPremiumGroup, loadResourceDataset, type FileKind, type ResourceDataset, type ResourceFolderNode, type ResourceItem, type ResourceNode } from '@/lib/resources-data';
import { ResourceWatch } from '@/components/lambda/resource-watch';

export type SourceId = 'cisce' | 'community';

interface SourceClassPickerProps {
  source: SourceId;
  classSlug?: string | undefined;
  subject?: string | undefined;
  title: string;
  desc: React.ReactNode;
}

const MISC_LABEL = 'Miscellaneous';

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
      {showCollapseUi && expanded && (
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
  const [activeFile, setActiveFile] = useState<ResourceItem | null>(null);
  const [activeFolderScope, setActiveFolderScope] = useState<ResourceFolderNode | null>(null);
  const [dataset, setDataset] = useState<ResourceDataset | undefined>(undefined);
  const [datasetLoading, setDatasetLoading] = useState(false);
  useEffect(() => {
    setActiveFile(null);
    setActiveFolderScope(null);
  }, [classSlug, subject]);
  const sourcePath = source === 'cisce' ? '/resources/cisce' : '/resources/community';
  const currentClass = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const hasDataset = classSlug ? hasResourceDataset(source, classSlug) : false;

  // Datasets are code-split per class/source (one of them is multiple MB), so
  // only fetch the one the visitor actually picked, instead of bundling every
  // class's resources into every /resources/* page load.
  useEffect(() => {
    if (!classSlug || !hasDataset) { setDataset(undefined); return; }
    let cancelled = false;
    setDatasetLoading(true);
    loadResourceDataset(source, classSlug).then(data => {
      if (!cancelled) { setDataset(data); setDatasetLoading(false); }
    });
    return () => { cancelled = true; };
  }, [source, classSlug, hasDataset]);

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
  if (currentClass && hasDataset && !dataset) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <div className="doxx-cards" aria-busy={datasetLoading}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
      </div>
    </main>;
  }

  // Class + dataset present, but no subject picked yet -> subject card grid.
  if (currentClass && dataset && !subject) {
    return <main className="container content-page">
      <Link to={sourcePath} search={{}} className="back-link"><ArrowLeft size={15} /> {t('resources.backToClasses')}</Link>
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <p className="library-note resource-total-count">{dataset.subjects.reduce((sum, s) => sum + s.items.length, 0) + dataset.misc.length} {t('resources.filesLabel')} {t('resources.total')}</p>
      <div className="doxx-cards">
        {dataset.subjects.map(s => {
          const isFeatured = s.subject === 'Featured';
          const meta = findSubjectMeta(s.subject);
          const Icon = isFeatured ? Sparkles : meta?.icon ?? FileText;
          return (
            <Link key={s.subject} to={sourcePath} search={{ class: classSlug, subject: s.subject }} className={`doxx-card${isFeatured ? ' tone-rose doxx-card-featured-glow' : meta ? ` tone-${meta.tone}` : ''}`}>
              <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
              <span className="doxx-card-title">{s.subject}</span>
              <span className="doxx-card-meta">{s.items.length} {t('resources.filesLabel')}</span>
            </Link>
          );
        })}
        {dataset.misc.length > 0 && (
          <Link to={sourcePath} search={{ class: classSlug, subject: MISC_LABEL }} className="doxx-card tone-rose">
            <span className="subject-icon doxx-subject-icon"><Folder size={22} strokeWidth={1.6} /></span>
            <span className="doxx-card-title">{t('resources.featured')}</span>
            <span className="doxx-card-meta">{dataset.misc.length} {t('resources.filesLabel')}</span>
          </Link>
        )}
      </div>
      {source === 'community' && disclaimer}
    </main>;
  }

  // Subject picked -> file list first; clicking a file opens the player view.
  if (currentClass && dataset && subject) {
    const subjectEntry = subject === MISC_LABEL ? undefined : dataset.subjects.find(s => s.subject === subject);
    const items = subject === MISC_LABEL ? dataset.misc : subjectEntry?.items ?? [];
    const editorFolders = subjectEntry?.editorFolders;
    const groups = groupItems(items);
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
      {items.length || editorFolders?.length ? (
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
