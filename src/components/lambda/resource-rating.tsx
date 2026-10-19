import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { getResourceRating, submitResourceRating, type ResourceRatingSummary } from '@/lib/ratings-server';
import { getVoterId } from '@/lib/voter-id';

interface ResourceRatingProps {
  fileId: string;
}

/** Renders a single star whose fill is clipped to `fraction` (0-1) of its
 * width, so e.g. a 3.4 average shows a 40%-filled 4th star rather than
 * rounding to a whole star. */
function PartialStar({ fraction, size = 18 }: { fraction: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <span className="resource-star" style={{ width: size, height: size }}>
      <Star size={size} strokeWidth={1.6} className="resource-star-outline" />
      <span className="resource-star-fill-clip" style={{ width: `${pct}%` }}>
        <Star size={size} strokeWidth={1.6} className="resource-star-fill" />
      </span>
    </span>
  );
}

/** Read-only "single partially-filled star + x.x + (n ratings)" summary,
 * used wherever a compact rating glance is enough (file cards, sidebar). */
export function ResourceRatingBadge({ average, count }: { average: number | null; count: number }) {
  const { t } = useI18n();
  if (!count || average === null) return null;
  return (
    <span className="resource-rating-badge">
      <PartialStar fraction={average} size={14} />
      <span className="resource-rating-value">{average.toFixed(1)}</span>
      <span className="resource-rating-count">({count})</span>
    </span>
  );
}

/** Full rating control for the Resource Watch detail pane: shows the
 * aggregate (single partially-filled star + average + rating count) and
 * lets the viewer pick 1-5 whole stars to submit/update their own rating. */
export function ResourceRatingControl({ fileId }: ResourceRatingProps) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<ResourceRatingSummary | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    const voterId = getVoterId();
    getResourceRating({ data: { fileId, voterId } }).then((result) => {
      if (!cancelled) setSummary(result);
    });
    return () => { cancelled = true; };
  }, [fileId]);

  const handleRate = async (rating: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const voterId = getVoterId();
      const result = await submitResourceRating({ data: { fileId, voterId, rating } });
      setSummary(result);
    } finally {
      setSubmitting(false);
    }
  };

  const average = summary?.average ?? null;
  const count = summary?.count ?? 0;
  const myRating = summary?.myRating ?? null;
  // While hovering, preview the whole-star fill the click would produce;
  // otherwise show the viewer's own rating (if any) filled solid, falling
  // back to the aggregate average as a partial fill when they haven't
  // rated yet.
  const displayFraction = (star: number) => {
    if (hovered !== null) return star <= hovered ? 1 : 0;
    if (myRating !== null) return star <= myRating ? 1 : 0;
    if (average === null) return 0;
    return Math.max(0, Math.min(1, average - (star - 1)));
  };

  return (
    <div className="resource-rating-control">
      <div className="resource-rating-summary">
        {count > 0 && average !== null ? (
          <>
            <PartialStar fraction={average} size={18} />
            <span className="resource-rating-value">{average.toFixed(1)}</span>
            <span className="resource-rating-count">({count} {count === 1 ? t('resources.rating.oneRating') : t('resources.rating.ratings')})</span>
          </>
        ) : (
          <span className="resource-rating-empty">{t('resources.rating.noRatings')}</span>
        )}
      </div>
      <div className="resource-rating-stars" role="radiogroup" aria-label={t('resources.rating.rateThis')} onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={myRating === star}
            aria-label={t('resources.rating.starLabel').replace('{n}', String(star))}
            className="resource-rating-star-btn"
            disabled={submitting}
            onMouseEnter={() => setHovered(star)}
            onClick={() => handleRate(star)}
          >
            <PartialStar fraction={displayFraction(star)} size={22} />
          </button>
        ))}
        {myRating !== null && (
          <span className="resource-rating-your-rating">{t('resources.rating.yourRating').replace('{n}', String(myRating))}</span>
        )}
      </div>
    </div>
  );
}
