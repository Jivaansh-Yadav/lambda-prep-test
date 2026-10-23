import { Link, useRouterState } from '@tanstack/react-router';
import { Menu, X, Home, BookOpen, ChevronDown, FileStack, MonitorPlay, Sun, Moon, HeartHandshake } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { BRAND_MARK } from '@/lib/brand';
import { classes } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Brand() {
  return <Link to="/" className="brand" aria-label="Lambda Prep home"><img src={BRAND_MARK} alt="" width={50} height={50} /><span>lambda<span className="brand-period">.</span></span></Link>;
}
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  // Shows only the *other* theme's icon — the one clicking will switch to.
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
export function Header() {
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const pathname = useRouterState({ select: s => s.location.pathname });
  const isHome = pathname === '/';
  const isClasses = pathname.startsWith('/classes');

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (navRef.current && navRef.current.contains(target)) return;
      // The Classes dropdown is portaled to <body>, so clicks inside it land
      // outside navRef — don't treat those as "outside" clicks.
      if (target instanceof Element && target.closest('[role="menu"]')) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return <header className="site-header"><div className="container header-inner" ref={navRef}><Brand /><Link to="/contribute" onClick={() => setOpen(false)} className="header-contribute-link"><HeartHandshake size={15} /><span>{t('footer.contribute')}</span></Link><nav className={`quick-nav ${open ? 'is-open' : ''}`} aria-label="Main navigation">
    <Link to="/" onClick={() => setOpen(false)} className={`nav-link ${isHome ? 'nav-active' : ''}`}><Home size={16} />{t('nav.home')}</Link>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`nav-link nav-link-trigger ${isClasses ? 'nav-active' : ''}`}><BookOpen size={16} />{t('nav.classes')}<ChevronDown size={14} className="nav-chevron" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="nav-dropdown-content">
        <DropdownMenuLabel className="nav-dropdown-label">ICSE</DropdownMenuLabel>
        <span className="nav-dropdown-row">
          {classes.filter(c => c.board === 'ICSE').map(c => <DropdownMenuItem key={c.slug} asChild>
            <Link to="/classes/$classId" params={{ classId: c.slug }} onClick={() => setOpen(false)}>{c.roman}</Link>
          </DropdownMenuItem>)}
        </span>
        <div className="nav-dropdown-separator" />
        <DropdownMenuLabel className="nav-dropdown-label">ISC</DropdownMenuLabel>
        <span className="nav-dropdown-row">
          {classes.filter(c => c.board === 'ISC').map(c => <DropdownMenuItem key={c.slug} asChild>
            <Link to="/classes/$classId" params={{ classId: c.slug }} onClick={() => setOpen(false)}>{c.roman}</Link>
          </DropdownMenuItem>)}
        </span>
      </DropdownMenuContent>
    </DropdownMenu>
    <Link to="/doxxmarks" search={{}} onClick={() => setOpen(false)} className="nav-link" activeProps={{ className: 'nav-link nav-active' }}><MonitorPlay size={16} />{t('nav.doxxmarks')}</Link>
    <Link to="/resources" onClick={() => setOpen(false)} className="nav-link" activeProps={{ className: 'nav-link nav-active' }}><FileStack size={16} />{t('nav.resources')}</Link>
    <ThemeToggle />
  </nav><Button variant="ghost" size="icon" className="mobile-menu" aria-label={open ? t('nav.close') : t('nav.open')} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</Button></div></header>;
}

export function Footer() {
  const { t } = useI18n();
  return <footer className="site-footer"><div className="container"><div className="footer-top"><div><Brand /></div><div className="footer-links"><div><p>{t('footer.tagline')}<br />{t('footer.tagline2')}</p></div></div></div><div className="footer-bottom"><span>{t('footer.copyright')}</span><span className="tiny-lambda"> λ</span></div></div></footer>;
}
