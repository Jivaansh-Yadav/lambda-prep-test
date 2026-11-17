import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useGoBack } from '@/hooks/use-go-back';

interface BackLinkProps {
  /** Fallback destination, used only when this tab has no history of ours to
   * go back to (a shared/bookmarked link opened in a fresh tab). */
  to: string;
  /** Search params for that fallback destination. */
  search?: Record<string, unknown>;
  label: string;
}

/** The one "go back" control used across the app.
 *
 * Every drill-down here is a pushed history entry, so the browser's own Back
 * already undoes exactly one level — including a different stream filter, a
 * reopened file, or a scroll position — which a hardcoded "one level up"
 * destination can't reproduce. That's why the click goes through
 * `useGoBack()` whenever there is history to pop.
 *
 * The element is always a `<Link>` with a real href, and `canGoBack` is only
 * consulted inside the click handler. Rendering a `<button>` when the tab had
 * history and an `<a>` otherwise made the server's markup differ from the
 * client's on hydration (React logged a mismatch and re-rendered the tree),
 * and the href keeps middle-click/open-in-new-tab working on the fallback.
 */
export function BackLink({ to, search = {}, label }: BackLinkProps) {
  const { canGoBack, goBack } = useGoBack();
  return (
    <Link
      to={to}
      search={search}
      className="back-link"
      onClick={event => {
        // Modified clicks (new tab, new window, download) and the
        // no-history case fall through to the router's normal navigation.
        if (!canGoBack || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        goBack();
      }}
    >
      <ArrowLeft size={15} /> {label}
    </Link>
  );
}
