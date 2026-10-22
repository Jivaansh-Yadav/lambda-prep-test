import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { SourceClassPicker } from '@/components/lambda/source-class-picker';

interface ResourcesSearch { class?: string | undefined; subject?: string | undefined; file?: string | undefined }

export const Route = createFileRoute('/resources/community')({
  validateSearch: (search: Record<string, unknown>): ResourcesSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    file: typeof search['file'] === 'string' ? search['file'] : undefined,
  }),
  head: () => pageHead('Community Resources', 'Notes, papers and resources shared by the student community, organized by class and subject.', '/resources/community'),
  component: CommunityResources,
});

function CommunityResources() {
  const { t } = useI18n();
  const { class: classSlug, subject, file } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SourceClassPicker
      source="community"
      classSlug={classSlug}
      subject={subject}
      file={file}
      onFileChange={fileId => navigate({ search: prev => ({ ...prev, file: fileId ?? undefined }), replace: true })}
      title={t('resources.community.title')}
      desc={<>{t('resources.community.descPrefix')} <a href="https://www.reddit.com/r/ICSE" target="_blank" rel="noreferrer">r/ICSE</a> {t('resources.community.descMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> {t('resources.community.descSuffix')}</>}
    />
  );
}
