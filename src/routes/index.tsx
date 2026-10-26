import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, Check, BookOpen, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BRAND_MARK, HERO_IMAGE } from '@/lib/brand';
import { classes, pageHead } from '@/lib/lambda';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/')({ head: () => pageHead('Lambda Prep — Your school resource hub', 'Discover curated ICSE and ISC study materials, revision notes and exam practice papers for Classes 9–12.', '/'), component: Index });
function Index() {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<number | null>(0);
  const faqs: Array<[string, string]> = [
    [t('faq.q1'), t('faq.a1')],
    [t('faq.q2'), t('faq.a2')],
    [t('faq.q3'), t('faq.a3')],
    [t('faq.q4'), t('faq.a4')],
  ];
  return <main>
    <section className="hero container"><div className="hero-copy"><p className="hero-tagline">{t('hero.tagline')}</p><h1>{t('hero.headline1')}<br className="desktop-break" /> <span>{t('hero.headline2')}</span></h1><p className="hero-description">{t('hero.description')}</p><div className="trust-points"><span><Check />{t('hero.trust1')}</span><span><Check />{t('hero.trust2')}</span></div><div className="hero-actions"><Button asChild size="lg"><Link to="/resources">{t('hero.explore')} <ArrowRight /></Link></Button><Button asChild size="lg" variant="outline"><Link to="/doxxmarks" search={{}}>{t('hero.openDoxxmarks')} <BookOpen /></Link></Button></div></div><div className="hero-art"><img src={HERO_IMAGE} alt={t('hero.imageAlt')} width={1200} height={912} fetchPriority="high" /></div></section>
    <section className="metrics-strip"><div className="container metrics-inner"><div className="metrics-intro"><ShieldCheck /><span>{t('metrics.intro')}</span></div><div className="metric"><strong>25k<span>+</span></strong><span>{t('metrics.students')}</span></div><div className="metric"><strong>10k<span>+</span></strong><span>{t('metrics.resources')}</span></div><div className="metric"><strong>~99<span>%</span></strong><span>{t('metrics.results')}</span></div></div></section>
    <section className="class-section container"><div className="section-heading"><div><h2>{t('class.choose')}<span className="text-primary">.</span></h2></div></div><div className="class-grid">{classes.map(c => <Link key={c.slug} to="/classes/$classId" params={{ classId: c.slug }} className={`class-card tone-${c.tone}`}><div className="class-card-top"><span className="subject-icon"><c.icon size={24} strokeWidth={1.6} /></span><span className="class-board">{c.board}</span></div><h3>Class {c.grade}</h3><span className="class-label">{c.label}</span><div className="card-bottom"><span>{t('class.exploreResources')}</span><ArrowUpRight size={18} /></div></Link>)}</div></section>
    <section className="how-section"><div className="container"><div className="section-heading"><div><h2>{t('how.title')}<span className="text-primary">.</span></h2><p>{t('how.subtitle')}</p></div></div><div className="steps-grid">{[{ title: t('how.step1.title'), text: t('how.step1.text') }, { title: t('how.step2.title'), text: t('how.step2.text') }, { title: t('how.step3.title'), text: t('how.step3.text') }].map((step, i) => <div className="step" key={step.title}><span className="step-number">0{i + 1}</span><div className="step-line" /><h3>{step.title}</h3><p>{step.text}</p></div>)}</div></div></section>
    <section className="mission-section container"><div className="mission-label"><img src={BRAND_MARK} alt="" width={300} height={300} /></div><div><span className="mission-principle">{t('mission.principle')}<span className="text-primary">.</span></span><h2>{t('mission.title1')}<br />{t('mission.title2')} <span>{t('mission.title3')}</span></h2><p>{t('mission.text')}</p></div></section>
    <section className="faq-section"><div className="container faq-layout"><div><h2>{t('faq.title1')}<br />{t('faq.title2')}<span className="text-primary">.</span></h2><p>{t('faq.subtitle')}</p></div><div className="faq-items">{faqs.map(([question, answer], i) => <div className={`faq-item ${expanded === i ? 'expanded' : ''}`} key={question}><Button variant="ghost" className="faq-trigger" onClick={() => setExpanded(expanded === i ? null : i)} aria-expanded={expanded === i} aria-controls={`faq-${i}`}><span>{question}</span><span className="faq-icon" aria-hidden="true" /></Button><div className="faq-panel" id={`faq-${i}`} role="region" aria-hidden={expanded !== i}><div><p>{answer}</p></div></div></div>)}</div></div></section>
  </main>;
}
