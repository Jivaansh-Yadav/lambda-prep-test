import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, MonitorPlay, PlayCircle, FileText } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { DoxxLesson } from '@/components/lambda/doxx-watch';
import { curriculumClasses } from '@/lib/curriculum';
import { classes, findSubjectMeta, pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';

// DoxxWatch pulls in the full Video.js + hls.js player stack (over 1MB), so
// it's only fetched once a lesson is actually opened — not on every visit to
// the chapter/topic browsing grid.
const DoxxWatch = lazy(() => import('@/components/lambda/doxx-watch').then(m => ({ default: m.DoxxWatch })));

interface DoxxSearch {
  class?: string | undefined;
  subject?: string | undefined;
  chapter?: number | undefined;
  topic?: number | undefined;
}

export const Route = createFileRoute('/doxxmarks')({
  validateSearch: (search: Record<string, unknown>): DoxxSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    chapter: typeof search['chapter'] === 'number' ? search['chapter'] : undefined,
    topic: typeof search['topic'] === 'number' ? search['topic'] : undefined,
  }),
  head: () => pageHead('Doxxmarks — Chapter-wise lessons', 'Browse classes, subjects, chapters and topics with interactive classes and concept videos.'),
  component: Doxxmarks,
});

function Doxxmarks() {
  const { t } = useI18n();
  const { class: classSlug, subject: subjectName, chapter: chapterIdx, topic: topicIdx } = Route.useSearch();
  const classMeta = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const currentClass = classMeta ? curriculumClasses.find(c => c.board === classMeta.board && c.roman === classMeta.roman) : undefined;
  const subject = currentClass?.subjects.find(s => s.name === subjectName);
  const chapter = subject && chapterIdx !== undefined ? subject.chapters[chapterIdx] : undefined;
  const topic = chapter && topicIdx !== undefined ? chapter.topics[topicIdx] : undefined;
  const [playing, setPlaying] = useState<DoxxLesson | null>(null);

  useEffect(() => {
    setPlaying(null);
  }, [subjectName, chapterIdx, topicIdx]);

  const backSearch = (() => {
    if (topic) return { class: classSlug, subject: subjectName, chapter: chapterIdx };
    if (chapter) return { class: classSlug, subject: subjectName };
    if (subject) return { class: classSlug };
    return {};
  })();

  return (
    <main className="container content-page">
      <nav className="doxx-breadcrumb" aria-label="Breadcrumb">
        <Link to="/doxxmarks" search={{}} className={!currentClass ? 'crumb-current' : ''}>{t('doxx.breadcrumbHome')}</Link>
        {currentClass && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ class: classSlug }} className={!subject ? 'crumb-current' : ''}>{currentClass.board} · Class {currentClass.roman}</Link>
        </>}
        {subject && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ class: classSlug, subject: subjectName }} className={!chapter ? 'crumb-current' : ''}>{subject.name}</Link>
        </>}
        {chapter && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: chapterIdx }} className={!topic ? 'crumb-current' : ''}>{chapter.name}</Link>
        </>}
        {topic && <><ChevronRight size={14} /><span className="crumb-current">{topic.name}</span></>}
      </nav>

      {(subject || chapter || topic) && (
        playing ? (
          <button type="button" className="back-link" onClick={() => setPlaying(null)}><ArrowLeft size={15} /> {t('doxx.back')}</button>
        ) : (
          <Link to="/doxxmarks" search={backSearch} className="back-link"><ArrowLeft size={15} /> {t('doxx.back')}</Link>
        )
      )}

      {!currentClass && <>
        <h1>{t('doxx.title')}<span className="text-primary">.</span></h1>
        <p className="page-intro">{t('doxx.intro')}</p>
        <div className="class-grid">
          {curriculumClasses.map(c => {
            const subjectCount = c.subjects.length;
            const chapterCount = c.subjects.reduce((n, s) => n + s.chapters.length, 0);
            const meta = classes.find(cl => cl.board === c.board && cl.roman === c.roman);
            const Icon = meta?.icon ?? BookOpen;
            return (
              <Link key={`${c.board}-${c.roman}`} to="/doxxmarks" search={{ class: meta?.slug }} className={`class-card${meta ? ` tone-${meta.tone}` : ''}`}>
                <div className="class-card-top"><span className="subject-icon"><Icon size={24} strokeWidth={1.6} /></span><span className="class-board">{c.board}</span></div>
                <h3>Class {c.roman}</h3>
                <p>{subjectCount} {t('doxx.subjectsLabel')} · {chapterCount} {t('doxx.chaptersLabel')}</p>
                <div className="card-bottom"><span>{t('doxx.browseChapters')}</span><ArrowUpRight size={18} /></div>
              </Link>
            );
          })}
        </div>
      </>}

      {currentClass && !subject && <>
        <h1>{currentClass.board} Class {currentClass.roman}<span className="text-primary">.</span></h1>
        <p className="page-intro">{t('doxx.chooseSubject')}</p>
        <div className="doxx-cards">
          {currentClass.subjects.map(s => {
            const meta = findSubjectMeta(s.name);
            const Icon = meta?.icon ?? BookOpen;
            return (
              <Link key={s.name} to="/doxxmarks" search={{ class: classSlug, subject: s.name }} className={`doxx-card${meta ? ` tone-${meta.tone}` : ''}`}>
                <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
                <span className="doxx-card-title">{s.name}</span>
                <span className="doxx-card-meta">{s.chapters.length} {t('doxx.chapterCount')} <ChevronRight size={14} /></span>
              </Link>
            );
          })}
          {!currentClass.subjects.length && <EmptyState text={t('doxx.empty.subjects')} />}
        </div>
      </>}

      {subject && !chapter && <>
        <h1>{subject.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass!.board} Class {currentClass!.roman} · {t('doxx.chooseChapter')}</p>
        <div className="doxx-cards">
          {subject.chapters.map((c, i) => (
            <Link key={c.name} to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: i }} className="doxx-card">
              <span className="doxx-card-title">{c.name}</span>
              <span className="doxx-card-meta">{c.topics.length} {t('doxx.topicCount')} <ChevronRight size={14} /></span>
            </Link>
          ))}
          {!subject.chapters.length && <EmptyState text={t('doxx.empty.chapters')} />}
        </div>
      </>}

      {chapter && !topic && <>
        <h1>{chapter.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{subject!.name} · {t('doxx.chooseTopic')}</p>
        <div className="doxx-cards">
          {chapter.topics.map((top, i) => (
            <Link key={top.name} to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: chapterIdx, topic: i }} className="doxx-card">
              <span className="doxx-card-title">{top.name}</span>
              <span className="doxx-card-meta">{top.videoLessons.length} {t('doxx.videosCount')} · {top.interactiveClasses.length} {t('doxx.interactiveCount')} <ChevronRight size={14} /></span>
            </Link>
          ))}
          {!chapter.topics.length && <EmptyState text={t('doxx.empty.topics')} />}
        </div>
        <section className="doxx-notes">
          <h2><FileText size={18} /> {t('doxx.revisionNotes')}</h2>
          {chapter.revisionNotes?.length ? (
            <div className="doxx-list">
              {chapter.revisionNotes.map(n => (
                <a key={n.link} href={n.link} target="_blank" rel="noreferrer" className="doxx-row">
                  <span className="doxx-row-title">{n.name}</span><ArrowUpRight size={18} />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text={t('doxx.empty.notes')} />
          )}
        </section>
      </>}

      {topic && <>
        {!playing && <>
          <h1>{topic.name}<span className="text-primary">.</span></h1>
          <p className="page-intro">{chapter!.name} · {subject!.name}</p>
        </>}

        {playing && (
          <Suspense fallback={<div className="doxx-watch-loading" aria-busy="true" />}>
            <DoxxWatch
              lessons={[
                ...topic.interactiveClasses.map(ic => ({ ...ic, kind: 'interactive' as const })),
                ...topic.videoLessons.map(v => ({ ...v, kind: 'video' as const })),
              ]}
              active={playing}
              topicName={topic.name}
              onSelect={setPlaying}
            />
          </Suspense>
        )}

        {!playing && <>
        <section className="doxx-notes">
          <h2><MonitorPlay size={18} /> {t('doxx.interactiveClasses')}</h2>
          {topic.interactiveClasses.length ? (
            <div className="doxx-cards">
              {topic.interactiveClasses.map(ic => (
                <button key={ic.link} type="button" className="doxx-card" onClick={() => { setPlaying({ ...ic, kind: 'interactive' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <span className="doxx-card-title">{ic.name}</span>
                  <span className="doxx-card-meta">{t('doxx.playInteractive')} <PlayCircle size={14} /></span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text={t('doxx.empty.interactive')} />
          )}
        </section>

        <section className="doxx-notes">
          <h2><PlayCircle size={18} /> {t('doxx.conceptVideos')}</h2>
          {topic.videoLessons.length ? (
            <div className="doxx-cards">
              {topic.videoLessons.map(v => (
                <button key={v.link} type="button" className="doxx-card" onClick={() => { setPlaying({ ...v, kind: 'video' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                  <span className="doxx-card-title">{v.name}</span>
                  <span className="doxx-card-meta">{t('doxx.watchVideo')} <PlayCircle size={14} /></span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text={t('doxx.empty.videos')} />
          )}
        </section>
        </>}
      </>}

      <footer className="doxx-disclaimer">
        <p className="doxx-disclaimer-title">{t('doxx.disclaimer.title')}</p>
        <p>{t('doxx.disclaimer.body')}</p>
      </footer>
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><BookOpen /><p>{text}</p></div>;
}
