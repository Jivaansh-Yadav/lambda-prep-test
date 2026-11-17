import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Eye, Flame } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { getTrendingFiles, type TrendingFile } from '@/lib/views-server';

interface ClassTrendingProps {
  classSlug: string | undefined;
}

/** "Trending today" — the ten most-opened files in this class since midnight
 * IST, shown above the subject grid.
 *
 * The list is genuinely absent, not empty, when nothing in the class has been
 * opened today: a class with no traffic (or a fresh deployment where the daily
 * buckets have only just started filling) renders nothing at all, so the page
 * looks exactly as it did before this section existed. Loading is intentionally
 * silent for the same reason — a skeleton that collapses into nothing would be
 * worse than a section that appears a moment later.
 *
 * One request per class page, keyed on the class, so switching class refetches
 * and re-rendering for anything else (search typing, stream tabs) does not. */
export function ClassTrending({ classSlug }: ClassTrendingProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<TrendingFile[]>([]);

  useEffect(() => {
    if (!classSlug) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setFiles([]);
    getTrendingFiles({ data: { classSlug, limit: 10 } })
      .then((result) => {
        if (!cancelled) setFiles(result.files);
      })
      .catch((error) => {
        // A social-proof section is never worth an error state on a working
        // page — log it and render nothing.
        console.error('[resources] failed to load trending files', classSlug, error);
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classSlug]);

  if (!files.length) return null;

  return (
    <section className="class-trending" aria-label={t('resources.trending.title')}>
      <div className="class-trending-head">
        <h2>
          <span className="class-trending-icon"><Flame size={16} /></span>
          {t('resources.trending.title')}
        </h2>
      </div>
      <ol className="class-trending-list">
        {files.map((file, index) => (
          <li key={file.fileId}>
            <Link
              to={file.source === 'cisce' ? '/resources/cisce' : '/resources/community'}
              search={{ class: classSlug, subject: file.subject, file: file.fileId }}
              className={`class-trending-item${index === 0 ? ' is-first' : ''}`}
            >
              <span className="class-trending-rank">{index + 1}</span>
              <span className="class-trending-body">
                <span className="class-trending-name">{file.name}</span>
                <span className="class-trending-meta">{file.subject}</span>
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
