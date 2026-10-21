import { useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { submitResourceFeedback } from '@/lib/feedback-server';
import { getVoterId } from '@/lib/voter-id';

interface ResourceFeedbackProps {
  fileId: string;
}

const MAX_LENGTH = 2000;

/** Free-text feedback box shown just below the star rating in the Resource
 * Watch detail pane. Every submission is stored as its own row (no "my
 * feedback" upsert like ratings), so a student can leave more than one note
 * over time; the admin panel's Feedback table is the only place these are
 * ever read back. */
export function ResourceFeedbackControl({ fileId }: ResourceFeedbackProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = (next: 'sent' | 'error', reason?: string) => {
    setStatus(next);
    setErrorReason(reason ?? null);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setStatus('idle');
      setErrorReason(null);
      statusTimerRef.current = null;
    }, 5000);
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const voterId = getVoterId();
      const result = await submitResourceFeedback({ data: { fileId, voterId, feedback: trimmed } });
      if (result.ok) {
        setValue('');
        showStatus('sent');
      } else {
        showStatus('error', result.reason);
      }
    } catch (error) {
      console.error('[resource-feedback] failed to submit feedback', error);
      showStatus('error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="resource-feedback-control" onSubmit={handleSubmit}>
      <label className="resource-feedback-label" htmlFor={`resource-feedback-${fileId}`}>
        {t('resources.feedback.label')}
      </label>
      <textarea
        id={`resource-feedback-${fileId}`}
        className="resource-feedback-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
        placeholder={t('resources.feedback.placeholder')}
        maxLength={MAX_LENGTH}
        rows={3}
        disabled={submitting}
      />
      <div className="resource-feedback-footer">
        <span className="resource-feedback-count">{value.length}/{MAX_LENGTH}</span>
        <button type="submit" className="resource-feedback-submit" disabled={submitting || !value.trim()}>
          {submitting ? t('resources.feedback.sending') : t('resources.feedback.submit')}
        </button>
      </div>
      <span className="resource-feedback-status" role="status" aria-live="polite">
        {status === 'sent' && t('resources.feedback.sent')}
        {status === 'error' && (errorReason || t('resources.feedback.failed'))}
      </span>
    </form>
  );
}
