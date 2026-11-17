import { Star } from 'lucide-react';
import { useFileRatingIndex } from '@/hooks/use-file-rating-index';
import { useI18n } from '@/lib/i18n';

/**
 * Compact rating glimpse for a file card / sidebar row.
 *
 * Renders nothing at all for files that have never been rated (`if
 * applicable`), so the overwhelmingly common case — an unrated file — stays
 * exactly as it was before this badge existed. The data comes from the shared
 * rating index (see use-file-rating-index.ts), so a grid of a thousand cards
 * still costs one request.
 *
 * A file whose average rounds to a perfect 5.0 gets the `is-top` variant: a
 * glowing gold pill instead of the flat neutral one, so a genuinely
 * top-rated file is scannable at a glance.
 */
export function FileRatingBadge({ fileId, inline = false }: { fileId: string; inline?: boolean }) {
  const { t } = useI18n();
  const index = useFileRatingIndex();
  const entry = index[fileId];
  if (!entry || entry.count <= 0) return null;

  const average = Math.round(entry.average * 10) / 10;
  const value = average.toFixed(1);
  const isTop = average >= 5;
  const label = t(isTop ? 'resources.rating.badgeTop' : 'resources.rating.badge')
    .replace('{avg}', value)
    .replace('{count}', String(entry.count));

  return (
    <span
      className={`file-rating-badge${isTop ? ' is-top' : ''}${inline ? ' is-inline' : ''}`}
      title={label}
      aria-label={label}
      role="img"
    >
      <Star size={10} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
      <span className="file-rating-badge-value">{value}</span>
    </span>
  );
}
