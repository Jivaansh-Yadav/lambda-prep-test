import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'lambda-theme';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Deterministic initial value — identical on the server (no `document`, always
  // 'light') and on the client's very first render. This is required for a clean
  // hydration: React does NOT patch an attribute that mismatches between server and
  // client HTML (it keeps the server's value and only warns), so if this instead
  // read the real class synchronously, a returning dark-mode visitor would get a
  // toggle permanently stuck showing the light icon/label — correct `.dark` class
  // and colors, wrong control state, with no way to self-heal short of a reload.
  // The inline bootstrap script (see __root.tsx + themeBootstrapScript below) has
  // already applied the real class/color-scheme to <html> before this ever runs, so
  // the page itself never shows the wrong theme — only this provider's own state
  // briefly says 'light' internally until the mount effect below corrects it.
  const [theme, setThemeState] = useState<Theme>('light');
  const didSyncToDom = useRef(false);
  // Tracks whether the visitor has ever explicitly picked a theme (via the toggle).
  // Until then, the site follows the OS/browser theme — including live changes.
  const hasExplicitChoice = useRef(false);

  // One-time, client-only correction: catch React's state up to what the bootstrap
  // script already rendered. A plain post-mount effect (not a hydration patch), so
  // React treats it as a normal state update and re-renders the toggle correctly.
  // useLayoutEffect (not useEffect) so this happens before the browser paints the
  // mismatched 'light' toggle state at all, instead of after.
  useLayoutEffect(() => {
    try {
      hasExplicitChoice.current = localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      // Storage can be unavailable; treat as no explicit choice.
    }
    setThemeState(readStoredTheme());
  }, []);

  // Live-follow the OS/browser theme while the visitor hasn't explicitly chosen one.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (hasExplicitChoice.current) return;
      setThemeState(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    // The first run of this effect always fires with the deterministic 'light'
    // placeholder above, not the real theme. Applying it to the DOM would strip the
    // `dark` class the bootstrap script already set for a real dark-mode visitor —
    // a one-frame flash back to light. Skip that single run; every later run (the
    // mount correction above, a system-theme change, or an actual user toggle) is a
    // genuine value change and is safe — and necessary — to apply.
    if (!didSyncToDom.current) {
      didSyncToDom.current = true;
      return;
    }
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    // Only persist an explicit choice. A live system-theme follow (hasExplicitChoice
    // still false) must NOT write to storage, or the visitor would be silently
    // opted out of future OS theme changes without ever having chosen anything.
    if (hasExplicitChoice.current) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Storage can be unavailable (private mode / blocked); theme still applies for this session.
      }
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    hasExplicitChoice.current = true;
    setThemeState(next);
  }, []);
  const toggleTheme = useCallback(() => {
    hasExplicitChoice.current = true;
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Memoized so consumers (just the header's theme toggle today, but this is
  // the top-level provider wrapping the whole tree) only re-render when the
  // theme itself actually changes, not on every render of ThemeProvider.
  const value = useMemo<ThemeContextValue>(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/**
 * Inline, pre-hydration script source (stringified) that applies the stored/system
 * theme to <html> before first paint, so there is no light->dark flash on load.
 * Rendered via a <script> tag with dangerouslySetInnerHTML in the root shell.
 */
export const themeBootstrapScript = `(function(){try{var k='${STORAGE_KEY}';var s=localStorage.getItem(k);var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;if(d){r.classList.add('dark');}r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
