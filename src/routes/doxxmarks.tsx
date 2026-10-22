import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, MonitorPlay, PlayCircle, FileText, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { DoxxLesson } from '@/components/lambda/doxx-watch';
import { curriculumClasses } from '@/lib/curriculum';
import { classes, findSubjectMeta, pageHead, SITE_URL } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { useFuseSearch } from '@/hooks/use-fuse-search';

// DoxxWatch pulls in the full Video.js + hls.js player stack (over 1MB), so
// it's only fetched once a lesson is actually opened — not on every visit to
// the chapter/topic browsing grid.
const DoxxWatch = lazy(() => import('@/components/lambda/doxx-watch').then(m => ({ default: m.DoxxWatch })));

// Referentially stable key arrays for useFuseSearch — a fresh array literal
// at the call site would rebuild the Fuse index on every render.
const SUBJECT_SEARCH_KEYS = ['name'];
const CHAPTER_ENTRY_SEARCH_KEYS = ['chapter.name'];

interface DoxxSearch {
  class?: string | undefined;
  subject?: string | undefined;
  chapter?: number | undefined;
  topic?: number | undefined;
  /** Position of the active lesson within the topic's combined
   * interactiveClasses + videoLessons list (in that order) — lessons have
   * no Drive id of their own, so this index is the stable, shareable
   * pointer back to a specific lesson. */
  lesson?: number | undefined;
}

export const Route = createFileRoute('/doxxmarks')({
  validateSearch: (search: Record<string, unknown>): DoxxSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    chapter: typeof search['chapter'] === 'number' ? search['chapter'] : undefined,
    topic: typeof search['topic'] === 'number' ? search['topic'] : undefined,
    lesson: typeof search['lesson'] === 'number' ? search['lesson'] : undefined,
  }),
  head: () => pageHead('Doxxmarks — Chapter-wise lessons', 'Browse classes, subjects, chapters and topics with interactive classes and concept videos.', '/doxxmarks'),
  component: Doxxmarks,
});

function Doxxmarks() {
  const { t } = useI18n();
  const { class: classSlug, subject: subjectName, chapter: chapterIdx, topic: topicIdx, lesson: lessonIdx } = Route.useSearch();
  const navigate = Route.useNavigate();
  const classMeta = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const currentClass = classMeta ? curriculumClasses.find(c => c.board === classMeta.board && c.roman === classMeta.roman) : undefined;
  const subject = currentClass?.subjects.find(s => s.name === subjectName);
  const chapter = subject && chapterIdx !== undefined ? subject.chapters[chapterIdx] : undefined;
  const topic = chapter && topicIdx !== undefined ? chapter.topics[topicIdx] : undefined;
  const [subjectQuery, setSubjectQuery] = useState('');
  const [chapterQuery, setChapterQuery] = useState('');

  // Combined lesson list in the same order DoxxWatch renders them — the
  // `lesson` search param is this array's index, so both must agree on
  // ordering for a deep link to resolve to the right lesson.
  const combinedLessons = useMemo((): DoxxLesson[] => topic
    ? [
        ...topic.interactiveClasses.map(ic => ({ ...ic, kind: 'interactive' as const })),
        ...topic.videoLessons.map(v => ({ ...v, kind: 'video' as const })),
      ]
    : [], [topic]);
  const playing = lessonIdx !== undefined ? combinedLessons[lessonIdx] ?? null : null;

  const playLesson = (lesson: DoxxLesson) => {
    const index = combinedLessons.findIndex(l => l.link === lesson.link && l.kind === lesson.kind);
    navigate({ search: prev => ({ ...prev, lesson: index >= 0 ? index : undefined }) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeLesson = () => navigate({ search: prev => ({ ...prev, lesson: undefined }) });

  useEffect(() => {
    setSubjectQuery('');
  }, [classSlug]);
  useEffect(() => {
    setChapterQuery('');
  }, [classSlug, subjectName]);

  // Chapters only carry their position as a navigation key (`chapter: i` in
  // the route search params), so the search corpus pairs each chapter with
  // its original index and Fuse searches/returns that pair — not just the
  // bare chapter, which would lose the index needed to link to it.
  const chapterEntries = useMemo(
    () => (subject?.chapters ?? []).map((ch, index) => ({ chapter: ch, index })),
    [subject]
  );
  const filteredSubjects = useFuseSearch(currentClass?.subjects ?? [], SUBJECT_SEARCH_KEYS, subjectQuery);
  const filteredChapterEntries = useFuseSearch(chapterEntries, CHAPTER_ENTRY_SEARCH_KEYS, chapterQuery);

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
          <button type="button" className="back-link" onClick={closeLesson}><ArrowLeft size={15} /> {t('doxx.back')}</button>
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
        {!!currentClass.subjects.length && (
          <label className="search-field resource-search"><Search size={18} /><input aria-label={t('doxx.searchSubjects.label')} placeholder={t('doxx.searchSubjects.placeholder')} value={subjectQuery} onChange={e => setSubjectQuery(e.target.value)} /></label>
        )}
        {currentClass.subjects.length && !filteredSubjects.length ? (
          <div className="empty-state"><BookOpen /><h3>{t('doxx.searchSubjects.empty.title')}</h3><p>{t('doxx.searchSubjects.empty.text')}</p></div>
        ) : (
          <div className="doxx-cards">
            {filteredSubjects.map(s => {
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
        )}
      </>}

      {subject && !chapter && <>
        <h1>{subject.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass!.board} Class {currentClass!.roman} · {t('doxx.chooseChapter')}</p>
        {!!subject.chapters.length && (
          <label className="search-field resource-search"><Search size={18} /><input aria-label={t('doxx.searchChapters.label')} placeholder={t('doxx.searchChapters.placeholder')} value={chapterQuery} onChange={e => setChapterQuery(e.target.value)} /></label>
        )}
        {subject.chapters.length && !filteredChapterEntries.length ? (
          <div className="empty-state"><BookOpen /><h3>{t('doxx.searchChapters.empty.title')}</h3><p>{t('doxx.searchChapters.empty.text')}</p></div>
        ) : (
          <div className="doxx-cards">
            {filteredChapterEntries.map(({ chapter: c, index: i }) => (
              <Link key={c.name} to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: i }} className="doxx-card">
                <span className="doxx-card-title">{c.name}</span>
                <span className="doxx-card-meta">{c.topics.length} {t('doxx.topicCount')} <ChevronRight size={14} /></span>
              </Link>
            ))}
            {!subject.chapters.length && <EmptyState text={t('doxx.empty.chapters')} />}
          </div>
        )}
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
              lessons={combinedLessons}
              active={playing}
              topicName={topic.name}
              onSelect={playLesson}
              shareUrl={`${SITE_URL}/doxxmarks?class=${encodeURIComponent(classSlug ?? '')}&subject=${encodeURIComponent(subjectName ?? '')}&chapter=${chapterIdx}&topic=${topicIdx}&lesson=${combinedLessons.findIndex(l => l.link === playing.link && l.kind === playing.kind)}`}
            />
          </Suspense>
        )}

        {!playing && <>
        <section className="doxx-notes">
          <h2><MonitorPlay size={18} /> {t('doxx.interactiveClasses')}</h2>
          {topic.interactiveClasses.length ? (
            <div className="doxx-cards">
              {topic.interactiveClasses.map(ic => (
                <button key={ic.link} type="button" className="doxx-card" onClick={() => playLesson({ ...ic, kind: 'interactive' })}>
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
                <button key={v.link} type="button" className="doxx-card" onClick={() => playLesson({ ...v, kind: 'video' })}>
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
