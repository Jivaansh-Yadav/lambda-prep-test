import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, ShieldCheck, UsersRound } from 'lucide-react';
import { pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/resources/')({ head: () => pageHead('Resource library', 'Find your ICSE and ISC class and explore subject-wise learning resources.', '/resources'), component: Resources });

function Resources() {
  const { t } = useI18n();

  return <main className="container content-page">
    <h1>{t('resources.title')}<span className="text-primary">.</span></h1>
    <p className="page-intro">{t('resources.intro')}</p>
    <div className="source-grid">
      <Link to="/resources/community" className="source-card tone-green">
        <span className="subject-icon"><UsersRound /></span>
        <h3>{t('resources.community.title')}</h3>
        <p>{t('resources.community.descPrefix')} <a href="https://www.reddit.com/r/ICSE" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>r/ICSE</a> {t('resources.community.descMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>ICSEcord</a> {t('resources.community.descSuffix')}</p>
        <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
      </Link>
      <Link to="/resources/cisce" className="source-card tone-blue">
        <span className="subject-icon"><ShieldCheck /></span>
        <h3>{t('resources.cisce.title')}</h3>
        <p>{t('resources.cisce.descPrefix')} <a href="https://cisce.org" target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>cisce.org</a> {t('resources.cisce.descSuffix')}</p>
        <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
      </Link>
    </div>
  </main>;
}
