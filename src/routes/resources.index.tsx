import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, ShieldCheck, UsersRound } from 'lucide-react';
import { pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/resources/')({ head: () => pageHead('Resource library', 'Find your ICSE and ISC class and explore subject-wise learning resources.', '/resources'), component: Resources });

/** Both cards carry real outbound links (Reddit, Discord, cisce.org) inside
 * their copy, so the card shell is a plain <div> with an absolutely
 * positioned overlay <Link> doing the "whole card is clickable" job. Nesting
 * those anchors inside the card's own <a> was invalid HTML — the browser
 * reparented them, the server markup no longer matched the DOM, and React
 * threw a hydration mismatch (#418) on every visit to /resources. */
function Resources() {
  const { t } = useI18n();

  return <main className="container content-page">
    <h1>{t('resources.title')}<span className="text-primary">.</span></h1>
    <p className="page-intro">{t('resources.intro')}</p>
    <div className="source-grid">
      <div className="source-card tone-green">
        <Link to="/resources/community" className="source-card-link" aria-label={t('resources.community.title')} />
        <span className="subject-icon"><UsersRound /></span>
        <h3>{t('resources.community.title')}</h3>
        <p>{t('resources.community.descPrefix')} <a href="https://www.reddit.com/r/ICSE" target="_blank" rel="noreferrer">r/ICSE</a> and <a href="https://www.reddit.com/r/ISCNERDS/" target="_blank" rel="noreferrer">r/ISCNERDS</a> {t('resources.community.descMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> and <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ISCcord</a> {t('resources.community.descSuffix')}</p>
        <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
      </div>
      <div className="source-card tone-blue">
        <Link to="/resources/cisce" className="source-card-link" aria-label={t('resources.cisce.title')} />
        <span className="subject-icon"><ShieldCheck /></span>
        <h3>{t('resources.cisce.title')}</h3>
        <p>{t('resources.cisce.descPrefix')} <a href="https://cisce.org" target="_blank" rel="noreferrer">cisce.org</a> {t('resources.cisce.descSuffix')}</p>
        <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
      </div>
    </div>
  </main>;
}
