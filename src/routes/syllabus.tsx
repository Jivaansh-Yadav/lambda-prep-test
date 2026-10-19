import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, BookOpen, ExternalLink } from 'lucide-react';
import { classes, getSubjects, pageHead } from '@/lib/lambda';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
export const Route = createFileRoute('/syllabus')({ head: () => pageHead('ICSE & ISC syllabus', 'Explore the subjects covered by Lambda Prep and consult official CISCE syllabus publications.', '/syllabus'), component: Syllabus });
function Syllabus() {
  const { t } = useI18n();
  return <main className="container content-page"><h1>{t('syllabus.title')}<span className="text-primary">.</span></h1><p className="page-intro">{t('syllabus.subtitle')}</p><div className="syllabus-notice"><BookOpen /><p>{t('syllabus.notice')}</p><Button variant="outline" asChild><a href="https://cisce.org/" target="_blank" rel="noreferrer">{t('syllabus.visitCisce')} <ExternalLink /></a></Button></div><div className="syllabus-grid">{[...new Set(classes.map(c => c.board))].map(board => <section className="syllabus-block" key={board}><h2>{board}</h2><ul>{getSubjects(board).map(s => <li key={s.name}>{s.name}</li>)}</ul></section>)}</div></main>;
}
