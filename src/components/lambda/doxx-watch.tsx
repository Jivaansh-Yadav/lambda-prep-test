import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import { VideoPlayer } from '@videojs/react/video';
import { VideoSkin } from '@/components/videojs/video/skin';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useI18n } from '@/lib/i18n';
import { ShareWidget } from '@/components/lambda/share-widget';
import { DOXX_CATEGORIES, categoryMeta, type DoxxCategory } from '@/lib/doxx-categories';

export interface DoxxLesson {
  name: string;
  link: string;
  /** How the lesson is played: interactive content renders in the sandboxed
   * frame, videos go through the Video.js/HLS player. Practice games, labs
   * and HOTS case studies are all interactive HTML, so they share `kind`
   * with interactive classes and are told apart by `category`. */
  kind: 'video' | 'interactive';
  category: DoxxCategory;
  /** Short badge on the card — the specific Extramarks type for activities
   * ("Virtual Lab", "Practice Game"), or a generic class/video label. */
  typeLabel: string;
}

interface DoxxWatchProps {
  lessons: DoxxLesson[];
  active: DoxxLesson;
  topicName: string;
  onSelect: (lesson: DoxxLesson) => void;
  /** Fully-qualified, directly-shareable URL for the active lesson (includes
   * a `?lesson=<index>` deep-link param, since lessons have no Drive id of
   * their own), used by the share popup. */
  shareUrl: string;
}

export function DoxxWatch({ lessons, active, topicName, onSelect, shareUrl }: DoxxWatchProps) {
  const { t } = useI18n();
  const activeCategory = categoryMeta(active.category);

  return (
    <div className="doxx-watch">
      <div className="doxx-watch-main">
        {active.kind === 'interactive' ? (
          <SandboxedFrame src={active.link} title={active.name} shareUrl={shareUrl} />
        ) : (
          <ContentVideoPlayer src={active.link} title={active.name} shareUrl={shareUrl} />
        )}
        <h2 className="doxx-watch-title">{active.name}</h2>
        <p className="doxx-watch-kind">
          {t(activeCategory.labelKey)} · {active.typeLabel}
          {' · '}{topicName}
        </p>
      </div>

      <aside className="doxx-watch-side" aria-label={t('doxx.moreInTopic')}>
        {DOXX_CATEGORIES.map(cat => (
          <PlaylistSection
            key={cat.id}
            category={cat.id}
            lessons={lessons.filter(l => l.category === cat.id)}
            active={active}
            onSelect={onSelect}
          />
        ))}
      </aside>
    </div>
  );
}

function PlaylistSection({ category, lessons, active, onSelect }: { category: DoxxCategory; lessons: DoxxLesson[]; active: DoxxLesson; onSelect: (l: DoxxLesson) => void }) {
  const { t } = useI18n();
  if (!lessons.length) return null;
  const meta = categoryMeta(category);
  const Icon = meta.icon;
  return (
    <div className={`doxx-playlist-section tone-${meta.tone}`}>
      <h3><span className="doxx-playlist-icon"><Icon size={15} /></span>{t(meta.labelKey)}</h3>
      <ul className="doxx-playlist-list">
        {lessons.map(lesson => {
          const isActive = active.link === lesson.link && active.kind === lesson.kind;
          return (
            <li key={lesson.link}>
              <button
                type="button"
                className={isActive ? 'doxx-side-item is-active' : 'doxx-side-item'}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => onSelect(lesson)}
              >
                <span className="doxx-side-thumb">
                  <Icon size={16} />
                </span>
                <span className="doxx-side-name">{lesson.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SandboxedFrame({ src, title, shareUrl }: { src: string; title: string; shareUrl: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapRef);

  return (
    <div className="doxx-sandbox-frame" ref={wrapRef}>
      <iframe
        src={src}
        title={title}
        // No allow-same-origin: combined with allow-scripts it would let this
        // third-party (Extramarks) content strip its own sandbox attribute or
        // navigate itself, defeating the sandbox entirely (GH issue #10). The
        // embedded Doxxmarks interactive content is cross-origin from this app
        // and doesn't need same-origin access to render/animate.
        sandbox="allow-scripts allow-forms allow-pointer-lock allow-popups"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="resource-pdf-toolbar">
        <button
          type="button"
          className="doxx-sandbox-fullscreen"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <ShareWidget compact url={shareUrl} title={title} />
      </div>
    </div>
  );
}

function ContentVideoPlayer({ src, title, shareUrl }: { src: string; title: string; shareUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, [src]);

  return (
    <div className="doxx-video-wrap-outer">
      <div className="doxx-video-wrap" ref={containerRef} aria-label={title}>
        {ready && (
          <VideoPlayer key={src}>
            <VideoSkin className="doxx-video-skin">
              <HlsJsVideo src={src} playsInline preload="auto" />
            </VideoSkin>
          </VideoPlayer>
        )}
      </div>
      <div className="doxx-video-toolbar">
        <ShareWidget compact url={shareUrl} title={title} />
      </div>
    </div>
  );
}
