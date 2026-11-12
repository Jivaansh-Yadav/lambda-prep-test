import raw from '@/data/doxxmarks_resources.json';

export interface LessonLink { name: string; link: string; }
/** A non-video, non-class activity node (practice game, virtual lab, HOTS
 * case study, …) crawled from Extramarks alongside the topic's lessons.
 * `type` is the Extramarks content group and doubles as the label shown on
 * the card; the crawler records `status` for the ones it HTTP-checked. */
export interface TopicActivity { type: string; title: string; link: string; status?: string; note?: string; }
export interface Topic { name: string; interactiveClasses: LessonLink[]; videoLessons: LessonLink[]; activities: TopicActivity[]; }
export interface Chapter { name: string; revisionNotes?: LessonLink[]; topics: Topic[]; }
export interface CurriculumSubject { name: string; chapters: Chapter[]; }
export interface CurriculumClass { board: string; roman: string; subjects: CurriculumSubject[]; }

interface RawData { boards: Record<string, { classes: Record<string, { subjects: CurriculumSubject[] }> }> }

const data = raw as unknown as RawData;

const named = <T extends { name: string }>(items: T[] | undefined): T[] =>
  (items ?? []).filter(item => item.name.trim().length > 0);

const withLinks = <T extends LessonLink>(items: T[] | undefined): T[] =>
  named(items).filter(item => item.link.trim().length > 0);

/** Activities are rendered as clickable cards that open in the embedded
 * frame, so an entry without a link (or one the crawler marked `BROKEN`) is
 * dropped instead of showing up as a dead card. Duplicate links within a
 * topic — the same game often hangs off two syllabus nodes — collapse to
 * one card. */
const withActivities = (items: TopicActivity[] | undefined): TopicActivity[] => {
  const seen = new Set<string>();
  return (items ?? []).flatMap((item): TopicActivity[] => {
    const title = item?.title?.trim() ?? '';
    const link = item?.link?.trim() ?? '';
    if (!title || !link || item.status === 'BROKEN' || seen.has(link)) return [];
    seen.add(link);
    return [{ type: item.type?.trim() ?? '', title, link, ...(item.status ? { status: item.status } : {}) }];
  });
};

export const curriculumClasses: CurriculumClass[] = Object.entries(data.boards).flatMap(([board, b]) =>
  Object.entries(b.classes).map(([roman, c]) => ({
    board,
    roman,
    subjects: named(c.subjects).map(subject => ({
      name: subject.name,
      chapters: named(subject.chapters).map(chapter => ({
        name: chapter.name,
        revisionNotes: withLinks(chapter.revisionNotes),
        topics: named(chapter.topics).map(topic => ({
          name: topic.name,
          interactiveClasses: withLinks(topic.interactiveClasses),
          videoLessons: withLinks(topic.videoLessons),
          activities: withActivities(topic.activities),
        })),
      })),
    })),
  }))
);

export function getCurriculumClass(board: string, roman: string) {
  return curriculumClasses.find(c => c.board === board && c.roman === roman);
}

export function findSubjectInClass(curriculumClass: CurriculumClass | undefined, name: string) {
  if (!curriculumClass) return undefined;
  const normalized = name.toLowerCase();
  return curriculumClass.subjects.find(s => s.name.toLowerCase() === normalized)
    ?? curriculumClass.subjects.find(s => normalized.startsWith(s.name.toLowerCase()) || s.name.toLowerCase().startsWith(normalized));
}
