import { describe, expect, it } from 'vitest';
import { classes, getSubjects } from '@/lib/lambda';
describe('Lambda class coverage', () => {
  it('uses the four requested class hub addresses', () => {
    expect(classes.map(c => c.slug)).toEqual(['icse-9', 'icse-10', 'isc-11', 'isc-12']);
  });
  it('includes all ICSE subjects', () => {
    expect(getSubjects('ICSE').map(s => s.name)).toEqual(['Biology', 'Chemistry', 'Commercial Applications', 'Commercial Studies', 'Economic Applications', 'Computer Applications', 'English Language', 'Literature in English', 'Geography', 'Hindi', 'History & Civics', 'Mathematics', 'Physics']);
  });
  it('filters ISC Science to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Science').map(s => s.name)).toEqual(['Biology', 'Chemistry', 'English Language', 'Literature in English', 'Hindi', 'Mathematics', 'Physics', 'Computer Science', 'Environmental Science']);
  });
  it('filters ISC Commerce to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Commerce').map(s => s.name)).toEqual(['English Language', 'Literature in English', 'Hindi', 'Mathematics', 'Accountancy', 'Business Studies', 'Commerce', 'Economics', 'Environmental Science']);
  });
  it('filters ISC Humanities to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Humanities').map(s => s.name)).toEqual(['English Language', 'Literature in English', 'Geography', 'Hindi', 'Economics', 'Environmental Science', 'History', 'Home Science', 'Political Science', 'Psychology', 'Sociology']);
  });
});
