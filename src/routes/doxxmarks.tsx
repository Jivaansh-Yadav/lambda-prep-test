import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, MonitorPlay, PlayCircle, FileText } from 'lucide-react';
import { useState } from 'react';
import { VideoPlayer } from '@/components/lambda/video-player';
import { curriculumClasses } from '@/lib/curriculum';
import { pageHead } from '@/lib/lambda';

interface DoxxSearch {
  board?: string | undefined;
  roman?: string | undefined;
  subject?: string | undefined;
  chapter?: number | undefined;
  topic?: number | undefined;
}

export const Route = createFileRoute('/doxxmarks')({
  validateSearch: (search: Record<string, unknown>): DoxxSearch => ({
    board: typeof search['board'] === 'string' ? search['board'] : undefined,
    roman: typeof search['roman'] === 'string' ? search['roman'] : undefined,
    subject: typeof search['subject'] === 'string' ? search['subject'] : undefined,
    chapter: typeof search['chapter'] === 'number' ? search['chapter'] : undefined,
    topic: typeof search['topic'] === 'number' ? search['topic'] : undefined,
  }),
  head: () => pageHead('Doxxmarks — Chapter-wise lessons', 'Browse classes, subjects, chapters and topics with interactive classes and concept videos.'),
  component: Doxxmarks,
});

function Doxxmarks() {
  const { board, roman, subject: subjectName, chapter: chapterIdx, topic: topicIdx } = Route.useSearch();
  const currentClass = board && roman ? curriculumClasses.find(c => c.board === board && c.roman === roman) : undefined;
  const subject = currentClass?.subjects.find(s => s.name === subjectName);
  const chapter = subject && chapterIdx !== undefined ? subject.chapters[chapterIdx] : undefined;
  const topic = chapter && topicIdx !== undefined ? chapter.topics[topicIdx] : undefined;
  const [playing, setPlaying] = useState<{ name: string; link: string; kind: 'video' | 'interactive' } | null>(null);

  const backSearch = (() => {
    if (topic) return { board, roman, subject: subjectName, chapter: chapterIdx };
    if (chapter) return { board, roman, subject: subjectName };
    if (subject) return { board, roman };
    return {};
  })();

  return (
    <main className="container content-page">
      <nav className="doxx-breadcrumb" aria-label="Breadcrumb">
        <Link to="/doxxmarks" search={{}} className={!currentClass ? 'crumb-current' : ''}>Doxxmarks</Link>
        {currentClass && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ board, roman }} className={!subject ? 'crumb-current' : ''}>{currentClass.board} · Class {currentClass.roman}</Link>
        </>}
        {subject && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ board, roman, subject: subjectName }} className={!chapter ? 'crumb-current' : ''}>{subject.name}</Link>
        </>}
        {chapter && <>
          <ChevronRight size={14} />
          <Link to="/doxxmarks" search={{ board, roman, subject: subjectName, chapter: chapterIdx }} className={!topic ? 'crumb-current' : ''}>{chapter.name}</Link>
        </>}
        {topic && <><ChevronRight size={14} /><span className="crumb-current">{topic.name}</span></>}
      </nav>

      {(subject || chapter || topic) && (
        <Link to="/doxxmarks" search={backSearch} className="back-link"><ArrowLeft size={15} /> Back</Link>
      )}

      {!currentClass && <>
        <h1>Doxxmarks<span className="text-primary">.</span></h1>
        <p className="page-intro">Pick your class to explore subjects, chapters and topics — with interactive classes and concept videos.</p>
        <div className="class-grid">
          {curriculumClasses.map(c => {
            const subjectCount = c.subjects.length;
            const chapterCount = c.subjects.reduce((n, s) => n + s.chapters.length, 0);
            return (
              <Link key={`${c.board}-${c.roman}`} to="/doxxmarks" search={{ board: c.board, roman: c.roman }} className="class-card">
                <div className="class-card-top"><span className="subject-icon"><BookOpen size={24} strokeWidth={1.6} /></span><span className="class-board">{c.board}</span></div>
                <h3>Class {c.roman}</h3>
                <p>{subjectCount} subjects · {chapterCount} chapters</p>
                <div className="card-bottom"><span>Browse chapters</span><ArrowUpRight size={18} /></div>
              </Link>
            );
          })}
        </div>
      </>}

      {currentClass && !subject && <>
        <h1>{currentClass.board} Class {currentClass.roman}<span className="text-primary">.</span></h1>
        <p className="page-intro">Choose a subject to see its chapters.</p>
        <div className="doxx-cards">
          {currentClass.subjects.map(s => (
            <Link key={s.name} to="/doxxmarks" search={{ board, roman, subject: s.name }} className="doxx-card">
              <span className="doxx-card-title">{s.name}</span>
              <span className="doxx-card-meta">{s.chapters.length} chapters <ChevronRight size={14} /></span>
            </Link>
          ))}
          {!currentClass.subjects.length && <EmptyState text="Subjects for this class are being prepared." />}
        </div>
      </>}

      {subject && !chapter && <>
        <h1>{subject.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass!.board} Class {currentClass!.roman} · Choose a chapter.</p>
        <div className="doxx-cards">
          {subject.chapters.map((c, i) => (
            <Link key={c.name} to="/doxxmarks" search={{ board, roman, subject: subjectName, chapter: i }} className="doxx-card">
              <span className="doxx-card-title">{c.name}</span>
              <span className="doxx-card-meta">{c.topics.length} topics <ChevronRight size={14} /></span>
            </Link>
          ))}
          {!subject.chapters.length && <EmptyState text="Chapters for this subject are being prepared." />}
        </div>
      </>}

      {chapter && !topic && <>
        <h1>{chapter.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{subject!.name} · Choose a topic.</p>
        <div className="doxx-cards">
          {chapter.topics.map((t, i) => (
            <Link key={t.name} to="/doxxmarks" search={{ board, roman, subject: subjectName, chapter: chapterIdx, topic: i }} className="doxx-card">
              <span className="doxx-card-title">{t.name}</span>
              <span className="doxx-card-meta">{t.videoLessons.length} videos · {t.interactiveClasses.length} interactive <ChevronRight size={14} /></span>
            </Link>
          ))}
          {!chapter.topics.length && <EmptyState text="Topics for this chapter are being prepared." />}
        </div>
        <section className="doxx-notes">
          <h2><FileText size={18} /> Chapter revision notes</h2>
          {chapter.revisionNotes?.length ? (
            <div className="doxx-list">
              {chapter.revisionNotes.map(n => (
                <a key={n.link} href={n.link} target="_blank" rel="noreferrer" className="doxx-row">
                  <span className="doxx-row-title">{n.name}</span><ArrowUpRight size={18} />
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text="Revision notes for this chapter are being reviewed and will appear here once published." />
          )}
        </section>
      </>}

      {topic && <>
        <h1>{topic.name}<span className="text-primary">.</span></h1>
        <p className="page-intro">{chapter!.name} · {subject!.name}</p>

        {playing && (
          <div className="modal-backdrop" onClick={() => setPlaying(null)}>
            <div role="dialog" aria-modal="true" aria-label={playing.name} className="doxx-video-modal" ref={modalRef} onClick={e => e.stopPropagation()}>
              <div className="doxx-video-modal-bar">
                <h2>{playing.name}</h2>
                <div className="doxx-video-modal-actions">
                  <Button size="icon" variant="ghost" aria-label="Full screen" onClick={() => {
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else void modalRef.current?.requestFullscreen();
                  }}><Maximize size={18} /></Button>
                  <Button size="icon" variant="ghost" aria-label="Close player" onClick={() => setPlaying(null)}><X size={18} /></Button>
                </div>
              </div>
              <VideoPlayer src={playing.link} title={playing.name} />
            </div>
          </div>
        )}

        <section className="doxx-notes">
          <h2><MonitorPlay size={18} /> Interactive classes</h2>
          {topic.interactiveClasses.length ? (
            <div className="doxx-cards">
              {topic.interactiveClasses.map(ic => (
                <a key={ic.link} href={ic.link} target="_blank" rel="noreferrer" className="doxx-card">
                  <img src={doxxInteractive} alt="" loading="lazy" width={1024} height={1024} className="doxx-card-badge" />
                  <span className="doxx-card-title">{ic.name}</span>
                  <span className="doxx-card-meta">Interactive class <ArrowUpRight size={14} /></span>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState text="Interactive classes for this topic are being prepared." />
          )}
        </section>

        <section className="doxx-notes">
          <h2><PlayCircle size={18} /> Concept videos</h2>
          {topic.videoLessons.length ? (
            <div className="doxx-cards">
              {topic.videoLessons.map(v => (
                <button key={v.link} type="button" className="doxx-card" onClick={() => setPlaying(v)}>
                  <img src={doxxVideo} alt="" loading="lazy" width={1024} height={1024} className="doxx-card-badge" />
                  <span className="doxx-card-title">{v.name}</span>
                  <span className="doxx-card-meta">Watch video <PlayCircle size={14} /></span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text="Concept videos for this topic are being prepared." />
          )}
        </section>
      </>}
    </main>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><BookOpen /><p>{text}</p></div>;
}
