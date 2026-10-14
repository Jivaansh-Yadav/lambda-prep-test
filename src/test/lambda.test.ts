import { describe, expect, it } from 'vitest';
import { classes, getSubjects } from '@/lib/lambda';
describe('Lambda class coverage', () => {
  it('uses the four requested class hub addresses', () => {
    expect(classes.map(c => c.slug)).toEqual(['icse-9', 'icse-10', 'isc-11', 'isc-12']);
  });
  it('includes all ten requested ICSE subjects', () => {
    expect(getSubjects('ICSE').map(s => s.name)).toEqual(['Biology', 'Chemistry', 'Commercial Applications', 'Computer Applications', 'English', 'Geography', 'Hindi', 'History & Civics', 'Mathematics', 'Physics']);
  });
  it('filters ISC Science to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Science').map(s => s.name)).toEqual(['Biology', 'Chemistry', 'English', 'Hindi', 'Mathematics', 'Physics', 'Computer Science']);
  });
  it('filters ISC Commerce to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Commerce').map(s => s.name)).toEqual(['English', 'Hindi', 'Mathematics', 'Accounts', 'Commerce', 'Economics']);
  });
  it('filters ISC Humanities to relevant and common subjects', () => {
    expect(getSubjects('ISC', 'Humanities').map(s => s.name)).toEqual(['English', 'Geography', 'Hindi', 'Economics', 'History', 'Political Science', 'Psychology']);
  });
});
