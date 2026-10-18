import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, MonitorPlay, Search, ShieldCheck, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { classes, getSubjects, pageHead } from '@/lib/lambda';
import { getCurriculumClass, findSubjectInClass } from '@/lib/curriculum';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/classes/$classId')({
  loader: ({ params }) => { const current = classes.find(c => c.slug === params.classId); if (!current) throw notFound(); return { current: { slug: current.slug, grade: current.grade, roman: current.roman, board: current.board, label: current.label } }; },
  head: ({ loaderData }) => pageHead(loaderData ? `${loaderData.current.board} Class ${loaderData.current.grade}` : 'Class not found', 'Explore subject-wise study resources, revision notes and practice papers for your class.'), component: ClassHub,
});
function ClassHub() {
  const { current } = Route.useLoaderData();
  return <ClassHubView key={current.slug} current={current} />;
}
type CurrentClass = ReturnType<typeof Route.useLoaderData>['current'];
function ClassHubView({ current }: { current: CurrentClass }) {
  const { t } = useI18n();
  const [stream, setStream] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const available = getSubjects(current.board, stream).filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const streamLabels: Record<string, string> = { All: t('hub.stream.all'), Science: t('hub.stream.science'), Commerce: t('hub.stream.commerce'), Humanities: t('hub.stream.humanities') };
  const curriculumClass = getCurriculumClass(current.board, current.roman);
  const selectedSubject = selected ? findSubjectInClass(curriculumClass, selected) : undefined;
  const hasDoxxContent = !!selectedSubject && selectedSubject.chapters.length > 0;

  return <main className="hub-page container">
    <Link to="/" className="back-link"><ArrowLeft size={15} /> {t('hub.allClasses')}</Link>
    <div className="hub-heading">
      <div><p className="eyebrow">{current.board}</p><h1>Class {current.grade}<span className="text-primary">.</span></h1><p>{current.label}</p></div>
      <span className="hub-badge"><BookOpen size={18} /> {current.board} {t('hub.curriculum')}</span>
    </div>
    <div className="hub-toolbar">
      {current.board === 'ISC' ? <div className="stream-tabs" role="tablist" aria-label="Stream">{['All', 'Science', 'Commerce', 'Humanities'].map(s => <Button variant="ghost" role="tab" aria-selected={stream === s} key={s} onClick={() => setStream(s)} className={stream === s ? 'selected-tab' : ''}>{streamLabels[s]}</Button>)}</div> : <h2>{t('hub.yourSubjects')} <span>{available.length}</span></h2>}
      <label className="search-field"><Search size={18} /><input aria-label={t('hub.searchLabel')} placeholder={t('hub.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} /></label>
    </div>
    <div className="subject-grid">
      {available.map(subject => <Button key={subject.name} variant="outline" className={`subject-card tone-${subject.tone}`} onClick={() => setSelected(subject.name)}>
        <span className="subject-icon"><subject.icon size={28} strokeWidth={1.6} /></span>
        <span className="subject-name">{subject.name}</span>
        <span className="subject-link">{t('hub.exploreSubject')} <ArrowUpRight size={14} /></span>
      </Button>)}
    </div>
    {!available.length && <div className="empty-state"><Search /><h3>{t('hub.empty.title')}</h3><p>{t('hub.empty.text')}</p><Button variant="outline" onClick={() => { setSearch(''); setStream('All'); }}>{t('hub.clearFilters')}</Button></div>}
    <div className="hub-note"></div>
    {selected && (
      <div className="modal-backdrop" onClick={() => setSelected(null)}>
        <section role="dialog" aria-modal="true" aria-labelledby="subject-title" className="subject-dialog" onClick={e => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="dialog-close" aria-label={t('hub.closeSubject')} onClick={() => setSelected(null)}><X /></Button>
          <p className="eyebrow">{current.board} · Class {current.grade}</p>
          <h2 id="subject-title">{selected}</h2>

          <div className="dialog-path-group">
            <p className="dialog-path-label">{t('hub.detail.classesLabel')}</p>
            {hasDoxxContent ? (
              <Link to="/doxxmarks" search={{ class: current.slug, subject: selected }} className="dialog-path-card" onClick={() => setSelected(null)}>
                <span className="subject-icon"><MonitorPlay size={22} /></span>
                <span className="dialog-path-copy"><strong>{t('hub.detail.classesTitle')}</strong><span>{t('hub.detail.classesText')}</span></span>
                <ArrowRight size={18} />
              </Link>
            ) : (
              <div className="dialog-path-card dialog-path-card-disabled" aria-disabled="true">
                <span className="subject-icon"><MonitorPlay size={22} /></span>
                <span className="dialog-path-copy"><strong>{t('hub.detail.classesTitle')}</strong><span>{t('hub.detail.comingSoonText')}</span></span>
                <span className="dialog-path-badge">{t('hub.detail.comingSoonBadge')}</span>
              </div>
            )}
          </div>

          <div className="dialog-path-group">
            <p className="dialog-path-label">{t('hub.detail.resourcesLabel')}</p>
            <Link to="/resources/community" search={{ class: current.slug, subject: selected }} className="dialog-path-card tone-green" onClick={() => setSelected(null)}>
              <span className="subject-icon"><UsersRound size={22} /></span>
              <span className="dialog-path-copy"><strong>{t('hub.detail.communityTitle')}</strong><span>{t('hub.detail.communityText')}</span></span>
              <ArrowRight size={18} />
            </Link>
            <Link to="/resources/cisce" search={{ class: current.slug, subject: selected }} className="dialog-path-card tone-blue" onClick={() => setSelected(null)}>
              <span className="subject-icon"><ShieldCheck size={22} /></span>
              <span className="dialog-path-copy"><strong>{t('hub.detail.cisceTitle')}</strong><span>{t('hub.detail.cisceText')}</span></span>
              <ArrowRight size={18} />
            </Link>
          </div>

          <Button variant="outline" className="dialog-back-btn" onClick={() => setSelected(null)}><ArrowLeft /> {t('hub.backToSubjects')}</Button>
        </section>
      </div>
    )}
  </main>;
}
