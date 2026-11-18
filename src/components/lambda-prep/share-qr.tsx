// share-qr.tsx
//
// The "scan me" block that leads the share popup, sharing a card with the link
// field: the resource link encoded as a QR Code, drawn with the site's own
// gradient and the Lambda mark knocked out of the centre.
//
// Three details that matter more than they look:
//
//   - The code is built from the same `url` prop the copy button copies, so the
//     two can never disagree about what a scan lands on.
//   - The centre mark is a knockout. A plate in the code's own background colour
//     is drawn *over* the modules instead of deleting them from the path, so the
//     surrounding modules keep their shape and the error-correction budget
//     simply absorbs the covered area.
//   - Encoding is pure and deterministic, so it can run during SSR: the code is
//     already in the first paint rather than popping in after hydration.

import { useId, useMemo } from 'react';
import { BRAND_MARK } from '@/lib/brand';
import { useI18n } from '@/lib/i18n';
import { encodeQr } from '@/lib/qr-code';
import { qrArt } from '@/lib/qr-art';

interface ShareQrProps {
  /** Absolute URL to encode — the same string the popup copies. */
  url: string;
  /** Human-readable target, used in the accessible description. */
  title: string;
}

/** Centre mark width as a fraction of the code, before the quiet zone. */
const MARK_RATIO = 0.26;

export function ShareQr({ url, title }: ShareQrProps) {
  const { t } = useI18n();
  const gradientId = useId();
  const art = useMemo(() => {
    try {
      // Level M recovers ~15% of the codewords; the mark covers ~7% of the
      // area, and interleaving spreads that damage across every block.
      return qrArt(encodeQr(url, { ecc: 'M' }));
    } catch {
      // A payload too large for any version (or an unusable URL) should lose the
      // code, not the popup.
      return null;
    }
  }, [url]);

  if (!art) return null;

  const markSize = art.size * MARK_RATIO;
  const markOrigin = (art.size - markSize) / 2;
  const paint = `url(#${gradientId})`;

  return (
    <div className="share-qr">
      <div className="share-qr-plate">
        <svg
          className="share-qr-code"
          viewBox={art.viewBox}
          role="img"
          aria-label={t('share.qrAlt').replace('{name}', title)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--qr-ink-from)" />
              <stop offset="52%" stopColor="var(--qr-ink-via)" />
              <stop offset="100%" stopColor="var(--qr-ink-to)" />
            </linearGradient>
          </defs>
          <path d={art.body} fill={paint} />
          <path d={art.eyes.rings} fill={paint} fillRule="evenodd" />
          <path d={art.eyes.dots} fill={paint} />
          <rect
            x={markOrigin}
            y={markOrigin}
            width={markSize}
            height={markSize}
            rx={markSize * 0.32}
            fill="var(--qr-plate)"
          />
          <image
            href={BRAND_MARK}
            x={markOrigin + markSize * 0.12}
            y={markOrigin + markSize * 0.12}
            width={markSize * 0.76}
            height={markSize * 0.76}
          />
        </svg>
      </div>
      <strong className="share-qr-label">{t('share.qrTitle')}</strong>
    </div>
  );
}
