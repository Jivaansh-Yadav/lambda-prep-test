import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Contrast, Download, ExternalLink, Eye, FileText, Maximize, Minimize, Share2 } from 'lucide-react';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useI18n } from '@/lib/i18n';
import { getGroupLabel, type ResourceItem } from '@/lib/resources-data';
import { VirtualFileGrid } from '@/components/lambda/virtual-file-grid';
import { ResourceRatingControl } from '@/components/lambda/resource-rating';
import { ResourceFeedbackControl } from '@/components/lambda/resource-feedback';
import { ShareWidget } from '@/components/lambda/share-widget';
import { recordResourceView } from '@/lib/views-server';
import { recordResourceShare, getResourceSharesBatch } from '@/lib/shares-server';

interface ResourceWatchProps {
  /** Items grouped by their original folder/section name, in display order. */
  groups: Array<{ group: string; items: ResourceItem[] }>;
  active: ResourceItem;
  onSelect: (item: ResourceItem) => void;
  /** Fully-qualified, directly-shareable URL for the active file (includes
   * the `?file=<driveId>` deep-link param), used by the share popup. */
  shareUrl: string;
}

const SIDEBAR_CAP = 6;

function SidebarSection({ group, items, active, onSelect }: { group: string; items: ResourceItem[]; active: ResourceItem; onSelect: (item: ResourceItem) => void }) {
  const { t } = useI18n();
  const isGeneral = group.toLowerCase() === 'general';
  const [expanded, setExpanded] = useState(isGeneral);
  // Below the 860px breakpoint the sidebar becomes a horizontally scrollable
  // row instead of a capped vertical list, so the "View all" collapse control
  // doesn't apply there — always show the full list on mobile.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 860);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const showCollapse = !isGeneral && !isMobile && items.length > SIDEBAR_CAP;
  const visibleItems = showCollapse && !expanded ? items.slice(0, SIDEBAR_CAP) : items;
  const shouldVirtualize = expanded && visibleItems.length > 80;

  return (
    <div className={`doxx-playlist-section${isGeneral ? ' resource-sidebar-editors-choice' : ''}`}>
      <h3><span className="doxx-playlist-icon"><FileText size={15} /></span>{getGroupLabel(group)} <span className="resource-count-badge">({items.length})</span></h3>
      {shouldVirtualize ? (
        <VirtualFileGrid
          className="doxx-playlist-list-virtual"
          items={visibleItems}
          minColumnWidth={9999}
          rowHeight={44}
          gap={4}
          maxHeight={360}
          renderItem={item => {
            const isActive = active.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={isActive ? 'doxx-side-item is-active' : 'doxx-side-item'}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(item)}
              >
                <span className="doxx-side-thumb"><FileText size={16} /></span>
                <span className="doxx-side-name">{item.name}</span>
              </button>
            );
          }}
        />
      ) : (
        <ul className="doxx-playlist-list">
          {visibleItems.map(item => {
            const isActive = active.id === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={isActive ? 'doxx-side-item is-active' : 'doxx-side-item'}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(item)}
                >
                  <span className="doxx-side-thumb"><FileText size={16} /></span>
                  <span className="doxx-side-name">{item.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {showCollapse && (
        expanded ? (
          <button type="button" className="resource-sidebar-collapse" onClick={() => setExpanded(false)}>
            {t('resources.showLess')} <ChevronUp size={14} />
          </button>
        ) : (
          <button type="button" className="resource-sidebar-collapse" onClick={() => setExpanded(true)}>
            {t('resources.viewAll')} <span className="resource-count-badge">({items.length})</span> <ChevronDown size={14} />
          </button>
        )
      )}
    </div>
  );
}

export function ResourceWatch({ groups, active, onSelect, shareUrl }: ResourceWatchProps) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapRef);
  const [sideHeight, setSideHeight] = useState<number | undefined>(undefined);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [shareCount, setShareCount] = useState<number | null>(null);
  // Dark-reading toggle for the embedded preview: Drive's PDF/doc viewer is
  // always a bright white page, which can be harsh in low light. There's no
  // same-origin access into the iframe's own document to theme it properly,
  // so this applies a CSS filter to the iframe itself instead — the one lever
  // available from outside. Kept as component state (not reset per file,
  // since the iframe is keyed by active.id and remounts on every file
  // change) so the preference sticks while browsing a section's files.
  const [inverted, setInverted] = useState(false);

  // Record one view per file load (not per render) — fires whenever the
  // active file's id changes, including the very first file shown. Also
  // fetches the file's persisted share count (without incrementing it) so
  // a previously-shared file's count shows immediately, not only after a
  // fresh share in this session.
  useEffect(() => {
    let cancelled = false;
    recordResourceView({ data: { fileId: active.id } }).then((result) => {
      if (!cancelled) setViewCount(result.count);
    });
    setShareCount(null);
    getResourceSharesBatch({ data: { fileIds: [active.id] } }).then((result) => {
      if (!cancelled) setShareCount(result[active.id] ?? 0);
    });
    return () => { cancelled = true; };
  }, [active.id]);

  const handleShare = () => {
    recordResourceShare({ data: { fileId: active.id } }).then((result) => {
      setShareCount(result.count);
    });
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      // Matching the sidebar height to the preview frame only makes sense in the
      // two-column desktop layout; below the 860px breakpoint the sidebar stacks
      // full-width under the preview, so a leftover inline height/max-height here
      // would squeeze it into a cramped, "zoomed" box instead of its natural size.
      if (window.innerWidth <= 860) {
        setSideHeight(undefined);
        return;
      }
      setSideHeight(el.getBoundingClientRect().height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  const previewSrc = `https://drive.google.com/file/d/${active.id}/preview`;
  const openSrc = `https://drive.google.com/file/d/${active.id}/view`;
  const downloadSrc = `https://drive.google.com/uc?export=download&id=${active.id}`;

  const formatDate = (value?: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  // Drive's createdTime is upload time and modifiedTime is the source file's
  // own last-modified stamp — for bulk-uploaded community content the two
  // frequently disagree (createdTime can land after modifiedTime). Showing
  // the later of the two under a single "Last updated" label avoids the
  // confusing "created after updated" ordering while still surfacing the
  // most recent known activity on the file.
  const lastUpdatedLabel = formatDate(
    [active.modifiedTime, active.createdTime]
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null
  );
  const formatSize = (value?: string | number | null) => {
    if (value === null || value === undefined) return null;
    const bytes = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const sizeLabel = formatSize(active.size);

  return (
    <div className="doxx-watch resource-watch">
      <div className="doxx-watch-main">
        <div className="doxx-sandbox-frame resource-pdf-frame" ref={wrapRef}>
          <iframe
            key={active.id}
            src={previewSrc}
            title={active.name}
            loading="lazy"
            allow="autoplay"
            className={inverted ? 'resource-pdf-inverted' : undefined}
          />
          <div className="resource-pdf-toolbar">
            <button
              type="button"
              className={inverted ? 'doxx-sandbox-fullscreen is-active' : 'doxx-sandbox-fullscreen'}
              onClick={() => setInverted(v => !v)}
              aria-pressed={inverted}
              aria-label={inverted ? t('resources.watch.darkModeOff') : t('resources.watch.darkModeOn')}
              title={inverted ? t('resources.watch.darkModeOff') : t('resources.watch.darkModeOn')}
            >
              <Contrast size={16} />
            </button>
            <button type="button" className="doxx-sandbox-fullscreen" onClick={toggleFullscreen} aria-label={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')} title={isFullscreen ? t('resources.watch.exitFullscreen') : t('resources.watch.fullscreen')}>
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
            <a className="doxx-sandbox-fullscreen" href={openSrc} target="_blank" rel="noreferrer" aria-label={t('resources.watch.openInDrive')} title={t('resources.watch.openInDrive')}>
              <ExternalLink size={16} />
            </a>
            <a className="doxx-sandbox-fullscreen" href={downloadSrc} target="_blank" rel="noreferrer" aria-label={t('resources.watch.download')} title={t('resources.watch.download')}>
              <Download size={16} />
            </a>
            <ShareWidget compact url={shareUrl} title={active.name} onShare={handleShare} />
          </div>
        </div>
        <h2 className="doxx-watch-title">{active.name}</h2>
        <p className="doxx-watch-kind">{getGroupLabel(active.group)}</p>
        {(lastUpdatedLabel || sizeLabel || viewCount !== null || shareCount !== null) && (
          <div className="resource-watch-meta">
            {lastUpdatedLabel && (
              <span className="resource-watch-meta-item">
                <span className="resource-watch-meta-label">{t('resources.watch.lastUpdated')}:</span> {lastUpdatedLabel}
              </span>
            )}
            {sizeLabel && (
              <span className="resource-watch-meta-item">
                <span className="resource-watch-meta-label">{t('resources.watch.size')}:</span> {sizeLabel}
              </span>
            )}
            {viewCount !== null && (
              <span className="resource-watch-meta-item resource-watch-meta-stat">
                <Eye size={13} /> {viewCount.toLocaleString()} {viewCount === 1 ? t('resources.watch.view') : t('resources.watch.views')}
              </span>
            )}
            {shareCount !== null && shareCount > 0 && (
              <span className="resource-watch-meta-item resource-watch-meta-stat">
                <Share2 size={13} /> {shareCount.toLocaleString()} {shareCount === 1 ? t('resources.watch.share') : t('resources.watch.shares')}
              </span>
            )}
          </div>
        )}
        <ResourceRatingControl key={active.id} fileId={active.id} />
        <ResourceFeedbackControl key={`${active.id}-feedback`} fileId={active.id} />
      </div>

      <aside className="doxx-watch-side" aria-label={t('resources.watch.fileList')} style={sideHeight ? { height: sideHeight, maxHeight: sideHeight } : undefined}>
        {groups.map(section => (
          <SidebarSection key={section.group} group={section.group} items={section.items} active={active} onSelect={onSelect} />
        ))}
      </aside>
    </div>
  );
}
