import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Mail, MessageSquareText, Share2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { DiscordIcon, RedditIcon, TelegramIcon, WhatsAppIcon } from '@/components/lambda/brand-icons';

interface ShareWidgetProps {
  /** Fully-qualified, directly-shareable URL for this specific resource. */
  url: string;
  /** Resource name, used in pre-filled message templates and the email subject. */
  title: string;
  /** Icon-only trigger matching the surrounding CTA row (e.g. the PDF
   * viewer's fullscreen/open-in-Drive/download toolbar) instead of the
   * default labeled button. */
  compact?: boolean;
}

/** Transient "Copied!" / "Link copied — paste it into Discord" hint shown
 * next to the trigger button after a share action, auto-clearing after a
 * few seconds so a later click isn't mistaken for a stale state. */
function useTransientHint(timeoutMs = 2500) {
  const [hint, setHint] = useState<{ message: string; ok: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const show = (message: string, ok: boolean) => {
    setHint({ message, ok });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { setHint(null); timerRef.current = null; }, timeoutMs);
  };
  return { hint, show };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy fallback below
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Share popup: opens from a CTA-row trigger, shows a copiable link and a
 * row of share targets (WhatsApp, Email, Message/SMS, Discord, Telegram,
 * Reddit), plus a "More" button that hands off to the device's native share
 * sheet when available. Every target gets the same pre-generated template
 * text so the resource is identifiable wherever it lands. */
export function ShareWidget({ url, title, compact = false }: ShareWidgetProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { hint, show } = useTransientHint();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const message = t('share.messageTemplate').replace('{name}', title).replace('{url}', url);
  const emailSubject = t('share.emailSubject').replace('{name}', title);

  const handleCopy = async () => {
    const ok = await copyToClipboard(url);
    show(ok ? t('share.copied') : t('share.copyFailed'), ok);
  };

  const openShareLink = (href: string) => {
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleDiscord = async () => {
    // Discord has no public web share-intent URL — the established pattern
    // is copying the link (with message) so the viewer pastes it into a
    // channel or DM themselves.
    const ok = await copyToClipboard(message);
    show(ok ? t('share.discordHint') : t('share.copyFailed'), ok);
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title, text: message, url });
    } catch {
      // User cancelled the share sheet or it's unsupported for this
      // payload — no error state needed, the popup just stays open.
    }
  };

  // WhatsApp and Discord are the two targets the Lambda Prep community
  // actually lives on, so they get their own full-width, brand-gradient
  // tiles (with the app name) above the regular grid of smaller targets.
  const heroTargets = [
    {
      key: 'whatsapp',
      label: t('share.whatsapp'),
      icon: <WhatsAppIcon width={30} height={30} />,
      onClick: () => openShareLink(`https://wa.me/?text=${encodeURIComponent(message)}`),
      className: 'share-hero-btn share-hero-whatsapp',
    },
    {
      key: 'discord',
      label: t('share.discord'),
      icon: <DiscordIcon width={30} height={30} />,
      onClick: handleDiscord,
      className: 'share-hero-btn share-hero-discord',
    },
  ];

  const targets = [
    {
      key: 'telegram',
      label: t('share.telegram'),
      icon: <TelegramIcon width={26} height={26} />,
      onClick: () => openShareLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`),
      className: 'share-target-btn share-target-telegram',
    },
    {
      key: 'reddit',
      label: t('share.reddit'),
      icon: <RedditIcon width={26} height={26} />,
      onClick: () => openShareLink(`https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`),
      className: 'share-target-btn share-target-reddit',
    },
    {
      key: 'email',
      label: t('share.email'),
      icon: <Mail size={24} strokeWidth={2} />,
      onClick: () => openShareLink(`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(message)}`),
      className: 'share-target-btn share-target-email',
    },
    {
      key: 'message',
      label: t('share.message'),
      icon: <MessageSquareText size={24} strokeWidth={2} />,
      onClick: () => openShareLink(`sms:?body=${encodeURIComponent(message)}`),
      className: 'share-target-btn share-target-message',
    },
  ];

  return (
    <div className="share-widget">
      {compact ? (
        <button
          type="button"
          className="doxx-sandbox-fullscreen"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={t('share.button')}
          title={t('share.button')}
        >
          <Share2 size={16} />
        </button>
      ) : (
        <button type="button" className="share-trigger-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Share2 size={16} /> {t('share.button')}
        </button>
      )}

      {open && (
        <div className="share-modal-backdrop" onClick={() => setOpen(false)}>
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-dialog-title"
            className="share-dialog"
            onClick={e => e.stopPropagation()}
          >
            <button type="button" className="share-dialog-close" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
            <h2 id="share-dialog-title">{t('share.title')}</h2>
            <p className="share-dialog-description">{t('share.description')}</p>

            <div className="share-link-row">
              <input className="share-link-input" type="text" readOnly value={url} onFocus={e => e.currentTarget.select()} />
              <button type="button" className="share-copy-btn" onClick={handleCopy}>
                <Copy size={15} /> {t('share.copyLink')}
              </button>
            </div>

            <div className="share-hero-row">
              {heroTargets.map(target => (
                <button key={target.key} type="button" className={target.className} onClick={target.onClick}>
                  <span className="share-hero-icon">{target.icon}</span>
                  <span className="share-hero-label">
                    <span className="share-hero-label-app">Lambda Prep</span>
                    <span className="share-hero-label-target">{target.label}</span>
                  </span>
                </button>
              ))}
            </div>

            <div className="share-targets-grid">
              {targets.map(target => (
                <button key={target.key} type="button" className={target.className} onClick={target.onClick}>
                  <span className="share-target-icon">{target.icon}</span>
                  <span className="share-target-label">{target.label}</span>
                </button>
              ))}
              {canNativeShare && (
                <button type="button" className="share-target-btn share-target-more" onClick={handleNativeShare}>
                  <span className="share-target-icon"><Share2 size={24} strokeWidth={2} /></span>
                  <span className="share-target-label">{t('share.more')}</span>
                </button>
              )}
            </div>

            <span className="share-hint" role="status" aria-live="polite">
              {hint && <>{hint.ok ? <Check size={13} /> : null} {hint.message}</>}
            </span>
          </section>
        </div>
      )}
    </div>
  );
}
