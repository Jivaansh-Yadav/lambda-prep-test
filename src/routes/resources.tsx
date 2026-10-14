import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Search } from 'lucide-react';
import { useState } from 'react';
import { classes, pageHead } from '@/lib/lambda';
export const Route = createFileRoute('/resources')({ head: () => pageHead('Resource library', 'Find your ICSE and ISC class and explore subject-wise learning resources.'), component: Resources });
function Resources() {
  const [query, setQuery] = useState('');
  const filtered = classes.filter(c => `${c.board} class ${c.grade} ${c.label}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="container content-page"><p className="eyebrow">LESS SEARCHING. MORE LEARNING.</p><h1>Your resource library<span className="text-primary">.</span></h1><p className="page-intro">A clearer path to your next chapter. Start with your class.</p><label className="search-field resource-search"><Search size={18} /><input aria-label="Search classes" placeholder="Find your class or board..." value={query} onChange={e => setQuery(e.target.value)} /></label><div className="class-grid">{filtered.map(c => <Link key={c.slug} to="/classes/$classId" params={{ classId: c.slug }} className={`class-card tone-${c.tone}`}><span className="subject-icon"><c.icon /></span><h3>Class {c.grade}</h3><span className="class-label">{c.label}</span><p>{c.description}</p><div className="card-bottom">Browse subjects <ArrowUpRight size={18} /></div></Link>)}</div>{!filtered.length && <div className="empty-state"><h3>No matching classes</h3><p>Try ICSE, ISC, or a class from 9 to 12.</p></div>}<p className="library-note">Our subject collections are being prepared. Published materials will appear in each class hub after review.</p></main>;
}
