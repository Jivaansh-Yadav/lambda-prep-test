import { Leaf, FlaskConical, Calculator, Monitor, PenLine, Globe2, Languages, Landmark, Ruler, Lightbulb, BookOpen, ChartNoAxesCombined, BriefcaseBusiness, Brain } from 'lucide-react';

export const classes = [
  { slug: 'icse-9', grade: '9', roman: 'IX', board: 'ICSE', label: 'ICSE Foundation', description: 'Build strong foundations. Get a head start.', icon: BookOpen, tone: 'blue' },
  { slug: 'icse-10', grade: '10', roman: 'X', board: 'ICSE', label: 'ICSE Board Prep', description: 'Prepare with purpose. Approach boards ready.', icon: FlaskConical, tone: 'green' },
  { slug: 'isc-11', grade: '11', roman: 'XI', board: 'ISC', label: 'ISC Core Streams', description: 'Find your stream. Deepen your understanding.', icon: Calculator, tone: 'purple' },
  { slug: 'isc-12', grade: '12', roman: 'XII', board: 'ISC', label: 'ISC Board Finals', description: 'Make every revision count. Finish strong.', icon: Landmark, tone: 'amber' },
] as const;
export const subjects = [
  { name: 'Biology', icon: Leaf, tone: 'green', streams: ['Science'] },
  { name: 'Chemistry', icon: FlaskConical, tone: 'purple', streams: ['Science'] },
  { name: 'Commercial Applications', icon: Calculator, tone: 'green', streams: ['Commerce'], icseOnly: true },
  { name: 'Computer Applications', icon: Monitor, tone: 'blue', streams: ['Science'], icseOnly: true },
  { name: 'English', icon: PenLine, tone: 'purple', streams: ['Science', 'Commerce', 'Humanities'] },
  { name: 'Geography', icon: Globe2, tone: 'teal', streams: ['Humanities'] },
  { name: 'Hindi', icon: Languages, tone: 'rose', streams: ['Science', 'Commerce', 'Humanities'] },
  { name: 'History & Civics', icon: Landmark, tone: 'amber', streams: ['Humanities'], icseOnly: true },
  { name: 'Mathematics', icon: Ruler, tone: 'blue', streams: ['Science', 'Commerce'] },
  { name: 'Physics', icon: Lightbulb, tone: 'amber', streams: ['Science'] },
  { name: 'Computer Science', icon: Monitor, tone: 'blue', streams: ['Science'], iscOnly: true },
  { name: 'Accounts', icon: Calculator, tone: 'green', streams: ['Commerce'], iscOnly: true },
  { name: 'Commerce', icon: BriefcaseBusiness, tone: 'teal', streams: ['Commerce'], iscOnly: true },
  { name: 'Economics', icon: ChartNoAxesCombined, tone: 'rose', streams: ['Commerce', 'Humanities'], iscOnly: true },
  { name: 'History', icon: Landmark, tone: 'amber', streams: ['Humanities'], iscOnly: true },
  { name: 'Political Science', icon: BookOpen, tone: 'purple', streams: ['Humanities'], iscOnly: true },
  { name: 'Psychology', icon: Brain, tone: 'rose', streams: ['Humanities'], iscOnly: true },
];
export function getSubjects(board: string, stream = 'All') {
  return subjects.filter(subject => (board === 'ISC' ? !subject.icseOnly : !subject.iscOnly) && (stream === 'All' || subject.streams.includes(stream)));
}
export function pageHead(title: string, description: string) {
  return { meta: [{ title: `${title} | Lambda Prep` }, { name: 'description', content: description }, { property: 'og:title', content: `${title} | Lambda Prep` }, { property: 'og:description', content: description }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary_large_image' }] };
}
