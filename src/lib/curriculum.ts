import raw from '@/data/curriculum.json';

export interface LessonLink { name: string; link: string; }
export interface Topic { name: string; interactiveClasses: LessonLink[]; videoLessons: LessonLink[]; }
export interface Chapter { name: string; revisionNotes?: LessonLink[]; topics: Topic[]; }
export interface CurriculumSubject { name: string; chapters: Chapter[]; }
export interface CurriculumClass { board: string; roman: string; subjects: CurriculumSubject[]; }

interface RawData { boards: Record<string, { classes: Record<string, { subjects: CurriculumSubject[] }> }> }

const data = raw as unknown as RawData;

const named = <T extends { name: string }>(items: T[] | undefined): T[] =>
  (items ?? []).filter(item => item.name.trim().length > 0);

const withLinks = <T extends LessonLink>(items: T[] | undefined): T[] =>
  named(items).filter(item => item.link.trim().length > 0);

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
        })),
      })),
    })),
  }))
);

export function getCurriculumClass(board: string, roman: string) {
  return curriculumClasses.find(c => c.board === board && c.roman === roman);
}
