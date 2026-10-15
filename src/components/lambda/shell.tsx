import { Link } from '@tanstack/react-router';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/lambda-logo.svg.asset.json';
import { classes } from '@/lib/lambda';

export function Brand() {
  return <Link to="/" className="brand" aria-label="Lambda Prep home"><img src={logo.url} alt="" width={50} height={50} /><span>lambda<span className="brand-period">.</span></span></Link>;
}
export function Header() {
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="container header-inner"><Brand /><nav className="grade-nav" aria-label="Choose your class"><span className="board-label">ICSE</span>{classes.slice(0, 2).map(c => <Link key={c.slug} to="/classes/$classId" params={{ classId: c.slug }} className="grade-pill" activeProps={{ className: 'grade-pill active' }}>{c.roman}</Link>)}<span className="nav-divider" /><span className="board-label">ISC</span>{classes.slice(2).map(c => <Link key={c.slug} to="/classes/$classId" params={{ classId: c.slug }} className="grade-pill" activeProps={{ className: 'grade-pill active' }}>{c.roman}</Link>)}</nav><nav className={`quick-nav ${open ? 'is-open' : ''}`} aria-label="Main navigation"><Link to="/resources" onClick={() => setOpen(false)} activeProps={{ className: 'nav-active' }}>Resources</Link><Link to="/syllabus" onClick={() => setOpen(false)} activeProps={{ className: 'nav-active' }}>Syllabus</Link></nav><Button variant="ghost" size="icon" className="mobile-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button></div></header>;
}
export function Footer() {
  return <footer className="site-footer"><div className="container"><div className="footer-top"><div><Brand /></div><div className="footer-links"><div><p>Better resources. Clearer understanding.<br />A stronger foundation for what’s next.</p></div></div></div><div className="footer-bottom"><span>© 2026 Lambda Education Pvt. Ltd. All rights reserved.</span><span className="tiny-lambda"> λ</span></div></div></footer>;
}
