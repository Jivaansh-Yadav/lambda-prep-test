import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, PlayCircle, FileText, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { DoxxLesson } from '@/components/lambda/doxx-watch';
import { NotePdfWatch } from '@/components/lambda/note-pdf-watch';
import { curriculumClasses, type LessonLink } from '@/lib/curriculum';
import { classes, findSubjectMeta, pageHead, getSiteOrigin, sortBySubjectOrder } from '@/lib/lambda';
import { DOXX_CATEGORIES, categoryForActivity, categoryMeta } from '@/lib/doxx-categories';
import { useI18n } from '@/lib/i18n';
import { useFuseSearch } from '@/hooks/use-fuse-search';
import { useGoBack } from '@/hooks/use-go-back';

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
  /** Index into the active chapter's `revisionNotes` array, used to open
   * the embedded PDF viewer for that note. `note` to avoid clashing with
   * the per-lesson `lesson` index above. */
  note?: number | undefined;
}

export const Route = createFileRoute('/doxxmarks')({
  validateSearch: (search: Record<string, unknown>): DoxxSearch => ({
    class: typeof search['class'] === 'string' ? search['class'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    chapter: typeof search['chapter'] === 'number' ? search['chapter'] : undefined,
    topic: typeof search['topic'] === 'number' ? search['topic'] : undefined,
    lesson: typeof search['lesson'] === 'number' ? search['lesson'] : undefined,
    note: typeof search['note'] === 'number' ? search['note'] : undefined,
  }),
  head: () => pageHead('Doxxmarks — Chapter-wise lessons', 'Browse classes, subjects, chapters and topics with interactive classes and concept videos.', '/doxxmarks'),
  component: Doxxmarks,
});

function Doxxmarks() {
  const { t } = useI18n();
  const { class: classSlug, subject: subjectName, chapter: chapterIdx, topic: topicIdx, lesson: lessonIdx, note: noteIdx } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { canGoBack, goBack } = useGoBack();
  const classMeta = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const currentClass = classMeta ? curriculumClasses.find(c => c.board === classMeta.board && c.roman === classMeta.roman) : undefined;
  const subject = currentClass?.subjects.find(s => s.name === subjectName);
  const chapter = subject && chapterIdx !== undefined ? subject.chapters[chapterIdx] : undefined;
  const topic = chapter && topicIdx !== undefined ? chapter.topics[topicIdx] : undefined;
  /** "1 chapter" / "12 chapters" — every count line on this page goes
   * through here so a single-item list never reads "1 activities". */
  const plural = (n: number, one: string, many: string) => `${n} ${t(n === 1 ? one : many)}`;
  const [subjectQuery, setSubjectQuery] = useState('');
  const [chapterQuery, setChapterQuery] = useState('');

  // Every playable item in the topic, in the order the topic page's sections
  // and DoxxWatch's playlist read it. Classes and videos come first, in their
  // historical order, so the `?lesson=<index>` deep links shared before
  // activities existed still resolve to the same lesson; activities follow.
  const combinedLessons = useMemo((): DoxxLesson[] => {
    if (!topic) return [];
    const classLessons: DoxxLesson[] = topic.interactiveClasses.map(ic => ({
      name: ic.name, link: ic.link, kind: 'interactive', category: 'interactive', typeLabel: t('doxx.type.interactiveClass'),
    }));
    const videos: DoxxLesson[] = topic.videoLessons.map(v => ({
      name: v.name, link: v.link, kind: 'video', category: 'videos', typeLabel: t('doxx.type.video'),
    }));
    const activities: DoxxLesson[] = topic.activities.map(a => ({
      name: a.title, link: a.link, kind: 'interactive', category: categoryForActivity(a.type), typeLabel: a.type,
    }));
    return [...classLessons, ...videos, ...activities];
  }, [topic, t]);
  const playing = lessonIdx !== undefined ? combinedLessons[lessonIdx] ?? null : null;

  const playLesson = (lesson: DoxxLesson) => {
    const index = combinedLessons.findIndex(l => l.link === lesson.link && l.kind === lesson.kind);
    navigate({ search: prev => ({ ...prev, lesson: index >= 0 ? index : undefined }) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeLesson = () => { if (canGoBack) goBack(); else navigate({ search: prev => ({ ...prev, lesson: undefined }) }); };

  // Chapter revision notes are plain `{name, link}` entries in
  // doxxmarks_resources.json — direct, signed GCS PDF URLs (refreshed weekly) rather
  // than Drive file ids, so they're rendered through NotePdfWatch's own
  // iframe instead of ResourceWatch/Drive's `/preview` viewer.
  const noteItems: LessonLink[] = chapter?.revisionNotes ?? [];
  const activeNote = noteIdx !== undefined ? noteItems[noteIdx] ?? null : null;

  const openNote = (item: LessonLink) => {
    const index = noteItems.findIndex(n => n.link === item.link);
    navigate({ search: prev => ({ ...prev, note: index >= 0 ? index : undefined }) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closeNote = () => { if (canGoBack) goBack(); else navigate({ search: prev => ({ ...prev, note: undefined }) }); };

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
  const orderedSubjects = useMemo(() => sortBySubjectOrder(currentClass?.subjects ?? []), [currentClass]);
  const filteredSubjects = useFuseSearch(orderedSubjects, SUBJECT_SEARCH_KEYS, subjectQuery);
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
        ) : activeNote ? (
          <button type="button" className="back-link" onClick={closeNote}><ArrowLeft size={15} /> {t('doxx.back')}</button>
        ) : canGoBack ? (
          // Every drill-down click below (class -> subject -> chapter ->
          // topic) is a `<Link>` push, so the browser's own Back already
          // undoes exactly one level — using it here keeps this button
          // consistent with the browser/OS back gesture instead of
          // re-deriving a fixed "one level up" destination.
          <button type="button" className="back-link" onClick={goBack}><ArrowLeft size={15} /> {t('doxx.back')}</button>
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
                <p>{plural(subjectCount, 'doxx.one.subject', 'doxx.many.subjects')} · {plural(chapterCount, 'doxx.one.chapter', 'doxx.many.chapters')}</p>
                <div className="card-bottom"><span>{t('doxx.browseChapters')}</span><ArrowUpRight size={18} /></div>
              </Link>
            );
          })}
        </div>
      </>}

      {currentClass && !subject && <>
        <div className="content-header">
          <h1>{currentClass.board} Class {currentClass.roman}<span className="text-primary">.</span></h1>
          <div className="content-header-row">
            <p className="page-intro">{t('doxx.chooseSubject')}</p>
            {!!currentClass.subjects.length && (
              <label className="search-field resource-search"><Search size={18} /><input aria-label={t('doxx.searchSubjects.label')} placeholder={t('doxx.searchSubjects.placeholder')} value={subjectQuery} onChange={e => setSubjectQuery(e.target.value)} /></label>
            )}
          </div>
        </div>
        {currentClass.subjects.length && !filteredSubjects.length ? (
          <div className="empty-state"><Search /><h3>{t('doxx.searchSubjects.empty.title')}</h3><p>{t('doxx.searchSubjects.empty.text')}</p></div>
        ) : (
          <div className="doxx-cards">
            {filteredSubjects.map(s => {
              const meta = findSubjectMeta(s.name);
              const Icon = meta?.icon ?? BookOpen;
              return (
                <Link key={s.name} to="/doxxmarks" search={{ class: classSlug, subject: s.name }} className={`doxx-card${meta ? ` tone-${meta.tone}` : ''}`}>
                  <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
                  <span className="doxx-card-title">{s.name}</span>
                  <span className="doxx-card-meta">{plural(s.chapters.length, 'doxx.one.chapter', 'doxx.many.chapters')} <ChevronRight size={14} /></span>
                </Link>
              );
            })}
            {!currentClass.subjects.length && <EmptyState text={t('doxx.empty.subjects')} />}
          </div>
        )}
      </>}

      {subject && !chapter && <>
        <div className="content-header">
          <h1>{subject.name}<span className="text-primary">.</span></h1>
          <div className="content-header-row">
            <p className="page-intro">{currentClass!.board} Class {currentClass!.roman} · {t('doxx.chooseChapter')}</p>
            {!!subject.chapters.length && (
              <label className="search-field resource-search"><Search size={18} /><input aria-label={t('doxx.searchChapters.label')} placeholder={t('doxx.searchChapters.placeholder')} value={chapterQuery} onChange={e => setChapterQuery(e.target.value)} /></label>
            )}
          </div>
        </div>
        {subject.chapters.length && !filteredChapterEntries.length ? (
          <div className="empty-state"><Search /><h3>{t('doxx.searchChapters.empty.title')}</h3><p>{t('doxx.searchChapters.empty.text')}</p></div>
        ) : (
          <div className="doxx-cards">
            {filteredChapterEntries.map(({ chapter: c, index: i }) => (
              <Link key={c.name} to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: i }} className="doxx-card">
                <span className="doxx-card-title">{c.name}</span>
                <span className="doxx-card-meta">{plural(c.topics.length, 'doxx.one.topic', 'doxx.many.topics')} <ChevronRight size={14} /></span>
              </Link>
            ))}
            {!subject.chapters.length && <EmptyState text={t('doxx.empty.chapters')} />}
          </div>
        )}
      </>}

      {chapter && !topic && <>
        {!activeNote && <>
          <h1>{chapter.name}<span className="text-primary">.</span></h1>
          <p className="page-intro">{subject!.name} · {t('doxx.chooseTopic')}</p>
          <div className="doxx-cards">
            {chapter.topics.map((top, i) => (
              <Link key={top.name} to="/doxxmarks" search={{ class: classSlug, subject: subjectName, chapter: chapterIdx, topic: i }} className="doxx-card">
                <span className="doxx-card-title">{top.name}</span>
                <span className="doxx-card-meta">
                  {/* Zero counts are dropped rather than printed — a card
                      reading "0 videos · 0 interactive · 1 activity" wraps
                      onto three lines in a narrow grid column. */}
                  {[
                    { n: top.videoLessons.length, one: 'doxx.one.video', many: 'doxx.many.videos' },
                    { n: top.interactiveClasses.length, one: 'doxx.one.interactive', many: 'doxx.many.interactive' },
                    { n: top.activities.length, one: 'doxx.one.activity', many: 'doxx.many.activities' },
                  ].filter(c => c.n > 0).map(c => plural(c.n, c.one, c.many)).join(' · ')}
                  <ChevronRight size={14} />
                </span>
              </Link>
            ))}
            {!chapter.topics.length && <EmptyState text={t('doxx.empty.topics')} />}
          </div>
        </>}
        <section className="doxx-notes">
          {!activeNote && <h2><FileText size={18} /> {t('doxx.revisionNotes')}</h2>}
          {activeNote ? (
            // Opens through the direct-PDF iframe viewer, scoped to just
            // this chapter's own notes (noteItems derives from
            // `chapter.revisionNotes` only) — not every chapter's notes
            // mixed together.
            <NotePdfWatch
              notes={noteItems}
              active={activeNote}
              onSelect={openNote}
              shareUrl={`${getSiteOrigin()}/doxxmarks?class=${encodeURIComponent(classSlug ?? '')}&subject=${encodeURIComponent(subjectName ?? '')}&chapter=${chapterIdx}&note=${noteItems.findIndex(n => n.link === activeNote.link)}`}
            />
          ) : noteItems.length ? (
            <div className="doxx-list">
              {noteItems.map(n => (
                <button key={n.link} type="button" className="doxx-row" onClick={() => openNote(n)}>
                  <span className="doxx-row-title">{n.name}</span><ArrowUpRight size={18} />
                </button>
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
              shareUrl={`${getSiteOrigin()}/doxxmarks?class=${encodeURIComponent(classSlug ?? '')}&subject=${encodeURIComponent(subjectName ?? '')}&chapter=${chapterIdx}&topic=${topicIdx}&lesson=${combinedLessons.findIndex(l => l.link === playing.link && l.kind === playing.kind)}`}
            />
          </Suspense>
        )}

        {!playing && <>
        {/* One section per material category, in DOXX_CATEGORIES order, each
            with its own accent colour, icon and card treatment so a game is
            distinguishable from a video or a HOTS case study at a glance.
            Categories a topic has nothing in are skipped — except the two
            core ones, which keep their "being prepared" note. */}
        {DOXX_CATEGORIES.map(cat => {
          const items = combinedLessons.filter(l => l.category === cat.id);
          if (!items.length && cat.id !== 'interactive' && cat.id !== 'videos') return null;
          const meta = categoryMeta(cat.id);
          const Icon = meta.icon;
          return (
            <section key={cat.id} className={`doxx-notes doxx-cat tone-${meta.tone}`}>
              <div className="doxx-cat-head">
                <span className="doxx-cat-chip"><Icon size={20} strokeWidth={1.9} /></span>
                <div className="doxx-cat-titles">
                  <h2>{t(meta.labelKey)}<span className="doxx-cat-count">{items.length}</span></h2>
                  <p className="doxx-cat-hint">{t(meta.hintKey)}</p>
                </div>
              </div>
              {items.length ? (
                <div className="doxx-cards doxx-cards-lessons">
                  {items.map(lesson => (
                    <button key={lesson.link} type="button" className="doxx-card doxx-card-lesson" onClick={() => playLesson(lesson)}>
                      <span className="doxx-card-icon"><Icon size={20} strokeWidth={1.9} /></span>
                      <span className="doxx-card-title">{lesson.name}</span>
                      <span className="doxx-card-meta">
                        <span className="doxx-card-type">{lesson.typeLabel}</span>
                        <PlayCircle size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState text={t(cat.id === 'videos' ? 'doxx.empty.videos' : 'doxx.empty.interactive')} />
              )}
            </section>
          );
        })}
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
