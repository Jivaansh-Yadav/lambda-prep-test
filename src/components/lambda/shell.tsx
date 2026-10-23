import { Link, useRouterState } from '@tanstack/react-router';
import { Menu, X, Home, BookOpen, ChevronDown, FileStack, MonitorPlay, Sun, Moon, HeartHandshake, Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BRAND_MARK } from '@/lib/brand';
import { classes } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { submitContactMessage } from '@/lib/contact-server';
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
  const [contactOpen, setContactOpen] = useState(false);
  return <footer className="site-footer"><div className="container"><div className="footer-top"><div><Brand /></div><div className="footer-links"><div><p>{t('footer.tagline')}<br />{t('footer.tagline2')}</p><button type="button" className="footer-contact-link" onClick={() => setContactOpen(true)}><Mail size={14} />{t('footer.sendMessage')}</button></div></div></div><div className="footer-bottom"><span>{t('footer.copyright')}</span><span className="tiny-lambda"> λ</span></div></div><ContactMessageDialog open={contactOpen} onOpenChange={setContactOpen} /></footer>;
}

type ContactMessageDialogProps = { open: boolean; onOpenChange: (next: boolean) => void };

/** The footer's "Send us a message" popup — a lightweight contact form
 * (name, email, subject, message) that lands in the contact_messages
 * table via submitContactMessage(). No email is sent automatically;
 * an admin reads these from the database later. Resets to a blank form
 * every time it's reopened, and shows a brief confirmation state before
 * closing itself on a successful send. */
function ContactMessageDialog({ open, onOpenChange }: ContactMessageDialogProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [socialHandle, setSocialHandle] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setEmail('');
    setSubject('');
    setSocialHandle('');
    setMessage('');
    setStatus('idle');
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError(null);
    try {
      const res = await submitContactMessage({ data: { name: name.trim(), email: email.trim(), subject: subject.trim(), message: message.trim(), socialHandle: socialHandle.trim() } });
      if (res.ok) {
        setStatus('sent');
      } else {
        setStatus('error');
        setError(res.reason);
      }
    } catch {
      setStatus('error');
      setError('Something went wrong. Please try again.');
    }
  }

  const canSubmit = name.trim() && email.trim() && subject.trim() && message.trim() && status !== 'sending';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="contact-dialog">
        {status === 'sent' ? (
          <div className="contact-dialog-success">
            <span className="contact-dialog-success-icon"><CheckCircle2 size={32} strokeWidth={1.6} /></span>
            <DialogTitle>Message sent<span className="text-primary">.</span></DialogTitle>
            <p>Thanks for reaching out — we'll get back to you soon.</p>
            <Button type="button" onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Send us a message</DialogTitle>
              <DialogDescription>Have a question, suggestion or issue? We'd love to hear from you.</DialogDescription>
            </DialogHeader>
            <form className="contact-dialog-form" onSubmit={handleSubmit}>
              <div className="contact-dialog-field">
                <Label htmlFor="contact-name">Name</Label>
                <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="Your name" />
              </div>
              <div className="contact-dialog-field">
                <Label htmlFor="contact-email">Email</Label>
                <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} placeholder="you@example.com" />
              </div>
              <div className="contact-dialog-field">
                <Label htmlFor="contact-subject">Subject</Label>
                <Input id="contact-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="What's this about?" />
              </div>
              <div className="contact-dialog-field">
                <Label htmlFor="contact-social">Discord or Reddit <span className="contact-dialog-optional">(optional)</span></Label>
                <Input id="contact-social" value={socialHandle} onChange={(e) => setSocialHandle(e.target.value)} maxLength={200} placeholder="e.g. username#1234 or u/yourname" />
              </div>
              <div className="contact-dialog-field">
                <Label htmlFor="contact-message">Message</Label>
                <Textarea id="contact-message" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 4000))} rows={4} placeholder="Tell us more…" />
              </div>
              {error && <p className="contact-dialog-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {status === 'sending' ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : 'Send message'}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
