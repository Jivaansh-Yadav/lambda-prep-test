import { useEffect, useState, type RefObject } from 'react';

/**
 * Tracks whether the given element is the page's current fullscreen target,
 * and returns a toggle function that enters/exits fullscreen on it. Shared
 * by every "sandboxed/video player with its own fullscreen button" surface
 * (Doxxmarks interactive classes, Doxxmarks videos, Resources PDF viewer) so
 * the same listener + toggle logic isn't duplicated per component.
 */
export function useFullscreen<T extends HTMLElement>(wrapRef: RefObject<T | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [wrapRef]);

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  };

  return { isFullscreen, toggleFullscreen };
}
