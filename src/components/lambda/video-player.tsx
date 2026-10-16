import { useEffect, useRef } from 'react';

interface VideoPlayerProps {
  src: string;
  title: string;
}

export function VideoPlayer({ src, title }: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let player: { dispose: () => void } | undefined;
    let cancelled = false;

    (async () => {
      const videojs = (await import('video.js')).default;
      await import('video.js/dist/video-js.css');
      if (cancelled || !containerRef.current) return;

      const el = document.createElement('video-js');
      el.className = 'vjs-big-play-centered';
      containerRef.current.appendChild(el);

      player = videojs(el, {
        controls: true,
        fluid: true,
        preload: 'auto',
        sources: [{ src, type: 'application/x-mpegURL' }],
      });
    })();

    return () => {
      cancelled = true;
      player?.dispose();
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, [src]);

  return <div className="video-player" ref={containerRef} aria-label={title} />;
}
