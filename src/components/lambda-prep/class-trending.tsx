import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Eye, Flame } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { getTrendingFiles, type TrendingFile } from '@/lib/views-server';

interface ClassTrendingProps {
  classSlug: string | undefined;
  /** Scopes the ranking to one subject's file list. Omitted on the class hub,
   * where the band spans every subject in the class. */
  subject?: string;
}

/** "Trending" — the five most-opened files for this class/subject, shown above
 * the file grid.
 *
 * The window widens by itself: today first, and only if that can't fill five
 * rows, the last 2 days, then 3, up to a week. The heading follows the window
 * actually used, so a quiet subject reads "Trending · last 3 days" instead of
 * quietly passing old traffic off as today's.
 *
 * The list is genuinely absent, not empty, when nothing here has been opened
 * in the past week: the page then looks exactly as it did before this section
 * existed. Loading is silent for the same reason — a skeleton collapsing into
 * nothing would be worse than a band that appears a moment later.
 *
 * One request per class/subject pair, keyed on both, so switching subject
 * refetches and re-rendering for anything else (search typing, stream tabs)
 * does not. */
export function ClassTrending({ classSlug, subject }: ClassTrendingProps) {
  const { t } = useI18n();
  const [trending, setTrending] = useState<{ files: TrendingFile[]; days: number }>({ files: [], days: 1 });

  useEffect(() => {
    if (!classSlug) {
      setTrending({ files: [], days: 1 });
      return;
    }
    let cancelled = false;
    setTrending({ files: [], days: 1 });
    getTrendingFiles({ data: { classSlug, subject, limit: 5 } })
      .then((result) => {
        if (!cancelled) setTrending({ files: result.files, days: result.days });
      })
      .catch((error) => {
        // A social-proof section is never worth an error state on a working
        // page — log it and render nothing.
        console.error('[resources] failed to load trending files', classSlug, subject, error);
        if (!cancelled) setTrending({ files: [], days: 1 });
      });
    return () => {
      cancelled = true;
    };
  }, [classSlug, subject]);

  if (!trending.files.length) return null;

  const title = trending.days <= 1
    ? t('resources.trending.title')
    : t('resources.trending.recent').replace('{n}', String(trending.days));

  return (
    <section className="class-trending" aria-label={title}>
      <div className="class-trending-head">
        <h2>
          <span className="class-trending-icon"><Flame size={16} /></span>
          {title}
        </h2>
      </div>
      <ol className="class-trending-list">
        {trending.files.map((file, index) => (
          <li key={file.fileId}>
            <Link
              to={file.source === 'cisce' ? '/resources/cisce' : '/resources/community'}
              search={{ class: classSlug, subject: file.subject, file: file.fileId }}
              className={`class-trending-item${index === 0 ? ' is-first' : ''}`}
            >
              <span className="class-trending-rank">{index + 1}</span>
              <span className="class-trending-body">
                <span className="class-trending-name">{file.name}</span>
                {/* A subject-scoped band would print the same subject on
                    every row, so the second line only earns its place on the
                    class hub, where the list spans subjects. */}
                {!subject && <span className="class-trending-meta">{file.subject}</span>}
              </span>
              <span className="class-trending-views">
                <Eye size={12} /> {file.views.toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
