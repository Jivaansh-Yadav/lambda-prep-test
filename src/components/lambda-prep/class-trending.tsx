import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Flame } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { FILE_KIND_LABEL, getFileKind } from '@/lib/resources-data';
import { getTrendingFiles, type TrendingFile } from '@/lib/views-server';

interface ClassTrendingProps {
  classSlug: string | undefined;
  /** The subject whose file grid this band sits above. Ranking is scoped to
   * it, so the band never quotes another subject's traffic. */
  subject: string | undefined;
}

/** "Trending" — the five most-opened files in this subject, shown above its
 * file grid as cards built from the same toolkit as the grid itself: same
 * 12px gutters, 16px padding, 12px radius and 14px/600 titles, so the band
 * reads as one more row of the library rather than a separate widget.
 *
 * The window widens by itself: today first, and only if that can't fill five
 * rows, the last 2 days, then 3, up to a week. The heading stays a plain
 * "Trending" whatever window was used — the list is social proof, not a
 * claim about when those opens happened.
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
  const [files, setFiles] = useState<TrendingFile[]>([]);

  useEffect(() => {
    if (!classSlug) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setFiles([]);
    getTrendingFiles({ data: { classSlug, subject, limit: 5 } })
      .then((result) => {
        if (!cancelled) setFiles(result.files);
      })
      .catch((error) => {
        // A social-proof section is never worth an error state on a working
        // page — log it and render nothing.
        console.error('[resources] failed to load trending files', classSlug, subject, error);
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classSlug, subject]);

  if (!files.length) return null;

  const title = t('resources.trending.title');

  return (
    <section className="class-trending" aria-label={title}>
      <div className="class-trending-head">
        <h2>
          <span className="class-trending-icon"><Flame size={16} /></span>
          {title}
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
              <span className="class-trending-top">
                <span className="class-trending-rank">{index + 1}</span>
                <span className="class-trending-kind">{FILE_KIND_LABEL[getFileKind(file.name)]}</span>
              </span>
              <span className="class-trending-name">{file.name}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
