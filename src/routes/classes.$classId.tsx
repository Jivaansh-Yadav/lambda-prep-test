import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, Search, BookOpen, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { classes, getSubjects, pageHead } from '@/lib/lambda';

export const Route = createFileRoute('/classes/$classId')({
  loader: ({ params }) => { const current = classes.find(c => c.slug === params.classId); if (!current) throw notFound(); return { current: { slug: current.slug, grade: current.grade, board: current.board, label: current.label } }; },
  head: ({ loaderData }) => pageHead(loaderData ? `${loaderData.current.board} Class ${loaderData.current.grade}` : 'Class not found', 'Explore subject-wise study resources, revision notes and practice papers for your class.'), component: ClassHub,
});
function ClassHub() {
  const { current } = Route.useLoaderData();
  return <ClassHubView key={current.slug} current={current} />;
}
type CurrentClass = ReturnType<typeof Route.useLoaderData>['current'];
function ClassHubView({ current }: { current: CurrentClass }) {
  const [stream, setStream] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const available = getSubjects(current.board, stream).filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="hub-page container"><Link to="/" className="back-link"><ArrowLeft size={15} /> All classes</Link><div className="hub-heading"><div><p className="eyebrow">{current.board}</p><h1>Class {current.grade}<span className="text-primary">.</span></h1><p>{current.label}</p></div><span className="hub-badge"><BookOpen size={18} /> {current.board} curriculum</span></div><div className="hub-toolbar">{current.board === 'ISC' ? <div className="stream-tabs" role="tablist" aria-label="Stream">{['All', 'Science', 'Commerce', 'Humanities'].map(s => <Button variant="ghost" role="tab" aria-selected={stream === s} key={s} onClick={() => setStream(s)} className={stream === s ? 'selected-tab' : ''}>{s}</Button>)}</div> : <h2>Your subjects <span>{available.length}</span></h2>}<label className="search-field"><Search size={18} /><input aria-label="Search subjects" placeholder="Find a subject..." value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="subject-grid">{available.map(subject => <Button key={subject.name} variant="outline" className={`subject-card tone-${subject.tone}`} onClick={() => setSelected(subject.name)}><span className="subject-icon"><subject.icon size={28} strokeWidth={1.6} /></span><span className="subject-name">{subject.name}</span><span className="subject-link">Explore subject <ArrowUpRight size={14} /></span></Button>)}</div>{!available.length && <div className="empty-state"><Search /><h3>No matching subjects</h3><p>Try a different search or stream.</p><Button variant="outline" onClick={() => { setSearch(''); setStream('All'); }}>Clear filters</Button></div>}<div className="hub-note"></div>{selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section role="dialog" aria-modal="true" aria-labelledby="subject-title" className="subject-dialog" onClick={e => e.stopPropagation()}><Button size="icon" variant="ghost" className="dialog-close" aria-label="Close subject" onClick={() => setSelected(null)}><X /></Button><p className="eyebrow">{current.board} · Class {current.grade}</p><h2 id="subject-title">{selected}</h2><div className="empty-state"><BookOpen /><h3>A stronger collection is taking shape.</h3><p>Study notes, prelim papers and verified solutions will appear here as they are reviewed. There are no published resources for this subject yet.</p></div><Button variant="outline" onClick={() => setSelected(null)}><ArrowLeft /> Back to subjects</Button></section></div>}</main>;
}
