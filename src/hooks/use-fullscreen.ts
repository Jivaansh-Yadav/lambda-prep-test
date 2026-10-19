import { useCallback, useEffect, useState, type RefObject } from 'react';

// Class toggled on the wrapper when we're emulating fullscreen in CSS instead
// of using the browser's Fullscreen API. Styled in styles.css.
const PSEUDO_FULLSCREEN_CLASS = 'pseudo-fullscreen';
// Class on <body> while pseudo-fullscreen is active, used only to lock
// background scrolling.
const PSEUDO_FULLSCREEN_BODY_CLASS = 'pseudo-fullscreen-open';

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/**
 * True when this browser can put an arbitrary element (not just a <video>)
 * into real fullscreen. iPhone Safari returns false here: it only supports
 * fullscreen on <video>, so `requestFullscreen` is simply absent on a <div>
 * and calling it does nothing at all.
 */
function nativeFullscreenAvailable(el: HTMLElement): boolean {
  const doc = document as WebkitDocument;
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false;
  const hasRequest =
    typeof el.requestFullscreen === 'function' ||
    typeof (el as WebkitElement).webkitRequestFullscreen === 'function';
  return Boolean(enabled) && hasRequest;
}

function currentFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function exitNativeFullscreen() {
  const doc = document as WebkitDocument;
  if (typeof doc.exitFullscreen === 'function') {
    void doc.exitFullscreen().catch(() => {});
  } else {
    void doc.webkitExitFullscreen?.();
  }
}

function requestNativeFullscreen(el: HTMLElement): Promise<void> {
  const webkitEl = el as WebkitElement;
  const fn =
    typeof el.requestFullscreen === 'function'
      ? el.requestFullscreen.bind(el)
      : webkitEl.webkitRequestFullscreen?.bind(el);
  // Safari's prefixed variant may return undefined rather than a promise.
  return Promise.resolve(fn?.()).then(() => undefined);
}

/**
 * Tracks whether the given element is the page's current fullscreen target,
 * and returns a toggle function that enters/exits fullscreen on it. Shared
 * by every "sandboxed/video player with its own fullscreen button" surface
 * (Doxxmarks interactive classes, Doxxmarks videos, Resources PDF viewer) so
 * the same listener + toggle logic isn't duplicated per component.
 *
 * Where the element-level Fullscreen API is unavailable (iPhone Safari can
 * only fullscreen <video>), this falls back to a CSS "pseudo-fullscreen":
 * the wrapper is pinned over the viewport and background scrolling is
 * locked, so the button still does something visible instead of silently
 * no-op'ing. Native fullscreen is always preferred where it works, and a
 * failed native request also falls back rather than leaving the user stuck.
 */
export function useFullscreen<T extends HTMLElement>(wrapRef: RefObject<T | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isPseudo = useCallback(
    () => Boolean(wrapRef.current?.classList.contains(PSEUDO_FULLSCREEN_CLASS)),
    [wrapRef]
  );

  const enterPseudo = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.classList.add(PSEUDO_FULLSCREEN_CLASS);
    document.body.classList.add(PSEUDO_FULLSCREEN_BODY_CLASS);
    setIsFullscreen(true);
  }, [wrapRef]);

  const exitPseudo = useCallback(() => {
    const el = wrapRef.current;
    el?.classList.remove(PSEUDO_FULLSCREEN_CLASS);
    document.body.classList.remove(PSEUDO_FULLSCREEN_BODY_CLASS);
    setIsFullscreen(false);
  }, [wrapRef]);

  // Keep state in sync when fullscreen is entered/exited outside of our own
  // button (Esc, the browser UI, or the prefixed Safari events).
  useEffect(() => {
    const onChange = () => {
      const el = wrapRef.current;
      if (currentFullscreenElement() === el) {
        setIsFullscreen(true);
      } else {
        // A native exit means we're no longer fullscreen; make sure a stale
        // pseudo state can't survive alongside it.
        if (el) el.classList.remove(PSEUDO_FULLSCREEN_CLASS);
        document.body.classList.remove(PSEUDO_FULLSCREEN_BODY_CLASS);
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [wrapRef]);

  // Esc exits pseudo-fullscreen (native fullscreen gets this from the
  // browser for free).
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPseudo()) exitPseudo();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, isPseudo, exitPseudo]);

  // Never leave the page scroll-locked or a wrapper stuck in the fixed
  // overlay position after the component goes away.
  useEffect(() => {
    const el = wrapRef.current;
    return () => {
      el?.classList.remove(PSEUDO_FULLSCREEN_CLASS);
      document.body.classList.remove(PSEUDO_FULLSCREEN_BODY_CLASS);
    };
  }, [wrapRef]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (isPseudo()) {
      exitPseudo();
      return;
    }
    if (currentFullscreenElement() === el) {
      exitNativeFullscreen();
      return;
    }
    if (!nativeFullscreenAvailable(el)) {
      enterPseudo();
      return;
    }
    requestNativeFullscreen(el).catch(() => {
      // e.g. Safari refusing on an unsupported element, or a permissions
      // policy blocking it — show the user something rather than nothing.
      enterPseudo();
    });
  }, [wrapRef, isPseudo, enterPseudo, exitPseudo]);

  return { isFullscreen, toggleFullscreen };
}
