import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { SourceClassPicker } from '@/components/lambda/source-class-picker';

interface ResourcesSearch { class?: string | undefined; subject?: string | undefined }

export const Route = createFileRoute('/resources/community')({
  validateSearch: (search: Record<string, unknown>): ResourcesSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
  }),
  head: () => pageHead('Community Resources', 'Notes, papers and resources shared by the student community, organized by class and subject.'),
  component: CommunityResources,
});

function CommunityResources() {
  const { t } = useI18n();
  const { class: classSlug, subject } = Route.useSearch();
  return (
    <SourceClassPicker
      source="community"
      classSlug={classSlug}
      subject={subject}
      title={t('resources.community.title')}
      desc={<>{t('resources.community.descPrefix')} <a href="https://www.reddit.com/r/ICSE" target="_blank" rel="noreferrer">r/ICSE</a> {t('resources.community.descMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> {t('resources.community.descSuffix')}</>}
    />
  );
}
