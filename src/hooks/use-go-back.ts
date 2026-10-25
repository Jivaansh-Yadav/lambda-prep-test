import { useCanGoBack, useRouter } from '@tanstack/react-router';

/** Wraps the browser's own Back behavior (same as the visitor pressing the
 * browser/OS back button) so a page's back button always returns to
 * wherever the visitor actually came from, instead of a hardcoded route —
 * which matters because many pages here are reachable via deep links
 * (shared file URLs, search results) where a fixed "back to X" would be
 * wrong.
 *
 * `canGoBack` is false only when this tab has no previous entry in its own
 * history (e.g. a shared link opened directly in a new tab) — callers
 * should render a sensible fixed-destination fallback in that case, since
 * there's nothing for the browser to go back to. */
export function useGoBack() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return { canGoBack, goBack: () => router.history.back() };
}
