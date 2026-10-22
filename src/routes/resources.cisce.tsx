import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { SourceClassPicker } from '@/components/lambda/source-class-picker';

interface ResourcesSearch { class?: string | undefined; subject?: string | undefined; file?: string | undefined }

export const Route = createFileRoute('/resources/cisce')({
  validateSearch: (search: Record<string, unknown>): ResourcesSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    file: typeof search['file'] === 'string' ? search['file'] : undefined,
  }),
  head: () => pageHead('Official CISCE Resources', 'Reference material sourced from CISCE\u2019s official syllabus, circulars and publications, organized by class and subject.', '/resources/cisce'),
  component: CisceResources,
});

function CisceResources() {
  const { t } = useI18n();
  const { class: classSlug, subject, file } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SourceClassPicker
      source="cisce"
      classSlug={classSlug}
      subject={subject}
      file={file}
      onFileChange={fileId => navigate({ search: prev => ({ ...prev, file: fileId ?? undefined }), replace: true })}
      title={t('resources.cisce.title')}
      desc={<>{t('resources.cisce.descPrefix')} <a href="https://cisce.org" target="_blank" rel="noreferrer">cisce.org</a> {t('resources.cisce.descSuffix')}</>}
    />
  );
}
