import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, MonitorPlay, PlayCircle } from 'lucide-react';
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video';
import { VideoPlayer } from '@videojs/react/video';
import { VideoSkin } from '@/components/videojs/video/skin';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useI18n } from '@/lib/i18n';

export interface DoxxLesson {
  name: string;
  link: string;
  kind: 'video' | 'interactive';
}

interface DoxxWatchProps {
  lessons: DoxxLesson[];
  active: DoxxLesson;
  topicName: string;
  onSelect: (lesson: DoxxLesson) => void;
}

export function DoxxWatch({ lessons, active, topicName, onSelect }: DoxxWatchProps) {
  const { t } = useI18n();
  const videoLessons = lessons.filter(l => l.kind === 'video');
  const interactiveLessons = lessons.filter(l => l.kind === 'interactive');

  return (
    <div className="doxx-watch">
      <div className="doxx-watch-main">
        {active.kind === 'interactive' ? (
          <SandboxedFrame src={active.link} title={active.name} />
        ) : (
          <ContentVideoPlayer src={active.link} title={active.name} />
        )}
        <h2 className="doxx-watch-title">{active.name}</h2>
        <p className="doxx-watch-kind">
          {active.kind === 'interactive' ? t('doxx.interactiveClasses') : t('doxx.conceptVideos')}
          {' · '}{topicName}
        </p>
      </div>

      <aside className="doxx-watch-side" aria-label={t('doxx.moreInTopic')}>
        <PlaylistSection
          icon={<MonitorPlay size={15} />}
          title={t('doxx.interactiveClasses')}
          lessons={interactiveLessons}
          active={active}
          onSelect={onSelect}
        />
        <PlaylistSection
          icon={<PlayCircle size={15} />}
          title={t('doxx.conceptVideos')}
          lessons={videoLessons}
          active={active}
          onSelect={onSelect}
        />
      </aside>
    </div>
  );
}

function PlaylistSection({ icon, title, lessons, active, onSelect }: { icon: React.ReactNode; title: string; lessons: DoxxLesson[]; active: DoxxLesson; onSelect: (l: DoxxLesson) => void }) {
  if (!lessons.length) return null;
  return (
    <div className="doxx-playlist-section">
      <h3><span className="doxx-playlist-icon">{icon}</span>{title}</h3>
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
                  {lesson.kind === 'interactive' ? <MonitorPlay size={16} /> : <PlayCircle size={16} />}
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

function SandboxedFrame({ src, title }: { src: string; title: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(wrapRef);

  return (
    <div className="doxx-sandbox-frame" ref={wrapRef}>
      <iframe
        src={src}
        title={title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <button
        type="button"
        className="doxx-sandbox-fullscreen"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>
    </div>
  );
}

function ContentVideoPlayer({ src, title }: { src: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, [src]);

  return (
    <div className="doxx-video-wrap" ref={containerRef} aria-label={title}>
      {ready && (
        <VideoPlayer key={src}>
          <VideoSkin className="doxx-video-skin">
            <HlsJsVideo src={src} playsInline preload="auto" />
          </VideoSkin>
        </VideoPlayer>
      )}
    </div>
  );
}
