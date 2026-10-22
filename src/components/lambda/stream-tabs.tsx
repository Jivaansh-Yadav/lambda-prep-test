import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

/** Shared ISC stream filter — Science/Commerce/Humanities (+All) — used on
 * the ISC class hub and, identically, on the CISCE/Community resource
 * pages so picking a stream filters the subject grid the same way in both
 * places. */
export const STREAM_OPTIONS = ['All', 'Science', 'Commerce', 'Humanities'] as const;

export function StreamTabs({ stream, onChange }: { stream: string; onChange: (stream: string) => void }) {
  const { t } = useI18n();
  const labels: Record<string, string> = {
    All: t('hub.stream.all'),
    Science: t('hub.stream.science'),
    Commerce: t('hub.stream.commerce'),
    Humanities: t('hub.stream.humanities'),
  };
  return (
    <div className="stream-tabs" role="tablist" aria-label="Stream">
      {STREAM_OPTIONS.map(s => (
        <Button
          variant="ghost"
          role="tab"
          aria-selected={stream === s}
          key={s}
          onClick={() => onChange(s)}
          className={stream === s ? 'selected-tab' : ''}
        >
          {labels[s]}
        </Button>
      ))}
    </div>
  );
}
