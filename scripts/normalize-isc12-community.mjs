#!/usr/bin/env node
/**
 * Normalize the ISC.exe 2.0 community directory (scripts/drive-crawl/source/
 * iscxe2-notes-data.json) into Lambda Prep's ISC Class XII community dataset,
 * using the same naming convention as the hand-built ICSE-10 collections:
 *
 *   "<Subject> - [<Topic> -] <Document type>[- <Detail>][- <Publisher>].pdf"
 *
 * Chapter notes become a folder tree (editorFolders) so a subject with 100+
 * files stays browsable; every other group is flat, but the topic is kept in
 * the name so alphabetical order means something.
 *
 * Nothing is downloaded or re-uploaded — only display metadata is rewritten,
 * so every file keeps streaming from wherever it already lives.
 *
 * Usage:
 *   node scripts/normalize-isc12-community.mjs [--csv] [--dump]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'scripts/drive-crawl/source/iscxe2-notes-data.json');
const OUT = path.join(ROOT, 'src/data/resources-community-isc-12.json');
const REVIEW = path.join(ROOT, 'plans/isc12-rename-review.csv');
// Names verified one-by-one against the actual file contents (driveId -> name),
// produced alongside scripts/isc12-reviewed.mjs.
const STOP_TAIL = new Set(['for', 'and', 'of', 'the', 'a', 'an', 'with', 'in', 'on', '&', '-']);
const NON_TOPIC = new Set([
  'Notes', 'Question Bank', 'Worksheet', 'Answer Key', 'Revision Notes', 'Formula Sheet',
  'Derivations', 'Past Paper', 'Specimen Paper', 'Sample Paper', 'Model Paper', 'Syllabus',
  'Complete Notes', 'Textbook', 'Workbook', 'PYQ (Chapter-wise)',
]);
const REVIEWED = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/isc12-reviewed.json'), 'utf8'));

/* ------------------------------------------------------------------ subjects */

// Source folder -> canonical ISC subject (matches src/lib/lambda-prep.ts).
const SUBJECT = {
  Accounts: 'Accountancy',
  Maths: 'Mathematics',
  English: 'English Language', // re-split below: Paper 1 vs Paper 2
  'Business Studies': 'Business Studies',
  Commerce: 'Commerce',
  'Computer Science': 'Computer Science',
  Economics: 'Economics',
  Geography: 'Geography',
  History: 'History',
  Biology: 'Biology',
  Chemistry: 'Chemistry',
  Physics: 'Physics',
  Psychology: 'Psychology',
  Sociology: 'Sociology',
};

const ENGLISH_PAPER_2 =
  /literature|beethoven|cookie|indigo|macbeth|prism|rhapsody|soft rains|medicine bag|telephone|tithonus|the guest|death be not proud|paper 2|lit\b/i;

/* --------------------------------------------------------------- categories */

// Curated topic per source category, namespaced by the source folder
// ("Papers" and "Notes" exist in several subjects with different meanings).
// `null` = no topic prefix. `:GROUP:<name>` pins the
// whole category to one group. `:PRELIMS:<collection>` keeps the original file
// name (ICSE-10 does the same for school prelim papers).
const CATEGORY = {
  // Accountancy
  'Accounts::Chapter 1 - Fundamentals': 'Fundamentals',
  'Accounts::Chapter 2 - Partnership Accounts': 'Partnership Accounts',
  'Accounts::Chapter 3 - Company Accounts': 'Company Accounts',
  'Accounts::Chapter 4 - Analysis of Financial Statements': 'Analysis of Financial Statements',
  'Accounts::Chapter 5 - Cash Flow Statement': 'Cash Flow Statement',
  'Accounts::Chapter 6 - Debentures & Redemption': 'Debentures & Redemption',
  'Accounts::Company Accounts': 'Company Accounts',
  'Accounts::Important Notes': null,
  'Accounts::Miscellaneous': null,
  'Accounts::Oswal': null,
  'Accounts::Arihant': null,
  'Accounts::Together With': null,
  'Accounts::An Aid to Accountancy SQP': null,
  'Accounts::Worksheets': null,

  // Biology
  'Biology::Chapter Notes': null,
  'Biology::General': null,
  'Biology::MCQs': 'MCQs',
  'Biology::Maha Revision': 'Maha Revision',
  'Biology::Notes': null,
  'Biology::Prelims 25-26': ':PRELIMS:Prelims 2025-26',
  'Biology::Sample Papers': ':GROUP:Sample & Specimen Papers',
  'Biology::Syllabus & Pattern': ':GROUP:Syllabus & Pattern',
  'Biology::PYQs': ':GROUP:PYQ Papers',

  // Chemistry
  'Chemistry::Inorganic / D-F Block': 'd- & f-Block Elements',
  'Chemistry::Organic / Alcohol Phenol Ether': 'Alcohols, Phenols & Ethers',
  'Chemistry::Organic / Aldehydes & Ketones': 'Aldehydes, Ketones & Acids',
  'Chemistry::Organic / Haloalkanes & Haloarenes': 'Haloalkanes & Haloarenes',
  'Chemistry::Organic / Named Reactions': 'Named Reactions',
  'Chemistry::Organic / Preparation': 'Organic Preparation',
  'Chemistry::Organic / Properties': 'Organic Properties',
  'Chemistry::Organic / Tests': 'Distinguishing Tests',
  'Chemistry::Organic notes': 'Organic Chemistry',
  'Chemistry::Physical / Solutions': 'Solutions',
  'Chemistry::Sample Papers': ':GROUP:Sample & Specimen Papers',
  'Chemistry::Worksheets on chemistry': null,
  'Chemistry::Worksheets on chemistry / Mathematical chemistry stuff': 'Mathematical Chemistry',
  'Chemistry::Worksheets on chemistry / Orgaynic stuff': 'Organic Chemistry',
  'Chemistry::Worksheets on chemistry / Theoretical metallic chemistry': 'Coordination & d-f Block',
  'Chemistry::Vatsal PDF (NEW)': null,
  'Chemistry::Vatsal PDF (NEW) / Unit 1,2,3- Mathematical Chemistry': 'Mathematical Chemistry',
  'Chemistry::Vatsal PDF (NEW) / Unit 4,5- Theoretical Chemistry': 'Coordination & d-f Block',
  'Chemistry::Vatsal PDF (NEW) / Unit 67,8,9,10- Shitty AHHHHHHH ORGANIC [Peak Ragebait Wallahi]': 'Organic Chemistry',

  // Commerce
  'Commerce::Obsession Handbook': 'Obsession Handbook',
  'Commerce::Oswal / Revision Notes and MCQ': null,
  'Commerce::Miscellaneous / Notes PPT': null,
  'Commerce::Consumer Protection': 'Consumer Protection',
  'Commerce::Management': 'Management',
  'Commerce::Marketing': 'Marketing',
  'Commerce::Principles Of Management': 'Principles of Management',
  'Commerce::Goyal': null,

  // Computer Science
  'Computer Science::Hand written notes': null,
  'Computer Science::Miscel': null,
  'Computer Science::Miscellaneous': null,
  'Computer Science::Notes for sec C': 'Section C — Java',
  'Computer Science::Other (Arrays and strings)': 'Arrays & Strings',
  'Computer Science::Papers': ':PRELIMS:Practice & Prelim Papers',
  'Computer Science::Practice programs': null,
  'Computer Science::Revision Notes': 'Revision Notes',
  'Computer Science::Chapter Notes': null,

  // Economics
  'Economics::Official ISC': ':GROUP:Syllabus & Pattern',
  'Economics::CFQs and Hots (Shubham + ISC Official CFQ)': ':GROUP:Question Banks',
  'Economics::DPSM QUESTION PAPERS FOR CLASS XII': ':PRELIMS:DPSM Question Papers',
  'Economics::Notes and Question Bank': null,
  'Economics::Oswal / Question Bank': null,
  'Economics::Other Schools (Not Worth it Now)': ':PRELIMS:Other Schools',
  'Economics::Practice Papers': ':PRELIMS:Practice Papers',
  'Economics::PYQs (~10Yrs)': ':GROUP:PYQ Papers',
  'Economics::QuesPapers + Answer Keys': ':GROUP:PYQ Papers',
  'Economics::Question Bank': null,
  'Economics::Revision notes': null,
  'Economics::Sample Paper (Shubham) + Oswal SPQs': ':GROUP:Sample & Specimen Papers',
  'Economics::Study Material': null,
  'Economics::Banking': 'Banking & Finance',
  'Economics::Economics': null,
  'Economics::Elasticity Of Demand': 'Elasticity of Demand',
  'Economics::Market Mechanism': 'Market Mechanism',
  'Economics::Money': 'Money & Banking',
  'Economics::National Income': 'National Income',
  'Economics::Producers Equilibrium': "Producer's Equilibrium",
  'Economics::Public Debt': 'Public Finance',
  'Economics::Public Finance': 'Public Finance',
  'Economics::Supply': 'Theory of Supply',
  'Economics::Theory of Consumer Behaviour': 'Theory of Consumer Behaviour',
  'Economics::Theory of Income and Employment': 'Theory of Income & Employment',
  'Economics::Topicwise Revision Worksheet': ':GROUP:Question Banks',
  'Economics::Vatsal': null,

  // English
  'English::Language': 'Paper 1 — Language',
  'English::Language / Papers': 'Paper 1 — Language',
  'English::Language / Writing Skills': 'Paper 1 — Writing Skills',
  'English::Literature': 'Paper 2 — Literature',
  'English::Literature / Beethoven': 'Beethoven & Small Towns',
  'English::Literature / Cookie Lady & Indigo': 'Cookie Lady & Indigo',
  'English::Literature / Death Be Not Proud': 'Death Be Not Proud',
  'English::Literature / Macbeth': 'Macbeth',
  'English::Literature / Macbeth_Questions': 'Macbeth',
  'English::Literature / Papers': 'Paper 2 — Literature',
  'English::Literature / Prism': 'Prism',
  'English::Literature / Rhapsody': 'Rhapsody',
  'English::Literature / Soft Rains': 'There Will Come Soft Rains',
  'English::Literature / Soft Rains & Medicine Bag': 'Soft Rains & Medicine Bag',
  'English::Literature / Strategy': 'Literature Strategy',
  'English::Literature / Telephone & Tithonus': 'Telephone & Tithonus',
  'English::Literature / The Guest': 'The Guest',

  // Geography / History
  'Geography::Papers': ':GROUP:Papers',
  'History::Papers': ':GROUP:Papers',
  'Geography::INDIAN': 'Indian History',
  'History::INDIAN': 'Indian History',
  'Geography::WORLD': 'World History',
  'History::WORLD': 'World History',

  // Mathematics
  'Maths::BSPs': 'Board Support Papers',
  'Maths::Formula Sheets': 'Formula Sheets',
  'Maths::Important Questions': 'Important Questions',
  'Maths::PYQs (ChapterWise)': 'PYQs (Chapter-wise)',
  'Maths::PYQs (Seperate Papers)': ':GROUP:PYQ Papers',
  'Maths::PYQs (Seperate Papers) / Specimen Papers': ':GROUP:Sample & Specimen Papers',
  'Maths::Pre-Boards': ':PRELIMS:Pre-Board Papers',
  'Maths::Sample Papers': ':GROUP:Sample & Specimen Papers',
  'Maths::Schools Papers': ':PRELIMS:School Papers',
  'Maths::Topicswise YT quest / 3D Geometry': '3D Geometry',
  'Maths::Topicswise YT quest / Conic Sections': 'Conic Sections',
  'Maths::Topicswise YT quest / Continuity & Differentiability': 'Continuity & Differentiability',
  'Maths::Topicswise YT quest / Derivatives': 'Differentiation',
  'Maths::Topicswise YT quest / Determinants & Matrices': 'Determinants & Matrices',
  'Maths::Topicswise YT quest / Differential Equations': 'Differential Equations',
  'Maths::Topicswise YT quest / Integration': 'Integration',
  'Maths::Topicswise YT quest / Inverse Trigonometry': 'Inverse Trigonometry',
  'Maths::Topicswise YT quest / Linear Programming': 'Linear Programming',
  'Maths::Topicswise YT quest / Probability': 'Probability',
  'Maths::Topicswise YT quest / Relations & Functions': 'Relations & Functions',
  'Maths::Topicswise YT quest / Surface Area & Volume': 'Surface Area & Volume',
  'Maths::Topicswise YT quest / Vectors': 'Vectors',

  // Physics
  'Physics::Books': ':GROUP:Books & Handbooks',
  'Physics::Chapter Summaries': null,
  'Physics::Derivations': 'Derivations',
  'Physics::Notes': null,
  'Physics::Other': ':PRELIMS:KISA & Mock Papers',
  'Physics::Other Schools': ':PRELIMS:KISA & Mock Papers',
  'Physics::Papers': ':GROUP:Papers',
  'Physics::PYQ_s (Chapterwise - Arihant)': 'PYQs (Chapter-wise)',
  'Physics::PYQs (Year Wise)': ':GROUP:PYQ Papers',
  'Physics::Suggestions': 'Most Probable Questions',

  // Psychology / Sociology
  'Psychology::Prelims': ':PRELIMS:Prelims',
  'Sociology::Prelims': ':PRELIMS:Prelims',
  'Psychology::Project': ':GROUP:Project',
  'Sociology::Project': ':GROUP:Project',
  'Psychology::CLASS XI': 'Class XI Refresher',
  'Sociology::CLASS XI': 'Class XI Refresher',
};

/* --------------------------------------------------------------- doc types */

// Applied to "<base> <category>". First match wins.
const DOC_RULES = [
  { type: 'Syllabus', re: /\bsyllabus\b/i },
  { type: 'Paper Pattern', re: /paper pattern|blueprint/i },
  { type: 'Answer Key', re: /answer key|\bansk\b|\bans\.? key\b/i },
  { type: 'Specimen Paper', re: /specimen/i },
  { type: 'Sample Paper', re: /sample paper|sample question|\bspq\b/i },
  { type: 'Model Paper', re: /model (test )?paper|model examination|model i\b/i },
  { type: 'Board Support Paper', re: /\bbsp\b|board support/i },
  { type: 'Prelim Paper', re: /prelim|pre[- ]?board|preboard|half.?yearly|selection exam|\bmock\b|practice paper/i },
  { type: 'Past Paper', re: /\bpyq|previous year|10 ?years?|last 10 years|^isc 20\d\d|^20\d\d$/i },
  { type: 'Question Bank', re: /question bank|questionbank|\bqb\b/i },
  { type: 'MCQs', re: /\bmcq/i },
  { type: 'Worksheet', re: /worksheet|\bwksht\b|\bwkst\b|\bws\b|assignment/i },
  { type: 'Formula Sheet', re: /formula|cheat ?sheet|gyan sutra/i },
  { type: 'Revision Notes', re: /revision notes|short notes|one ?shot|mind map|maha.?revision|full package/i },
  { type: 'Diagram Sheet', re: /diagram/i },
  { type: 'Derivation', re: /derivation/i },
  { type: 'Notes', re: /notes?|chapter|theory|booklet|handbook|e-?book|study material|course/i },
];

// Per-category overrides that win over DOC_RULES.
const CATEGORY_TYPE = {
  Derivations: 'Derivation',
  'Chapter Summaries': 'Notes',
  BSPs: 'Board Support Paper',
  'Formula Sheets': 'Formula Sheet',
  Predictions: 'Most Probable Questions',
  Suggestions: 'Most Probable Questions',
  'Important Questions': 'Important Questions',
  'PYQs (ChapterWise)': 'PYQ (Chapter-wise)',
  'PYQ_s (Chapterwise - Arihant)': 'PYQ (Chapter-wise)',
  'Revision notes': 'Revision Notes',
  'Hand written notes': 'Handwritten Notes',
  'Obsession Handbook': 'Handbook',
  Project: 'Project File',
  'CLASS XI': 'Notes',
  'Other (Arrays and strings)': 'Notes',
  'Notes for sec C': 'Notes',
  'Practice programs': 'Practice Questions',
  'Topicswise YT quest / Derivatives': 'Notes',
};

/* -------------------------------------------------------- text normalising */

const FIXES = [
  [/\bintegeration\b/gi, 'Integration'],
  [/\bintrigation\b/gi, 'Integration'],
  [/\bdifinite\b/gi, 'Definite'],
  [/\bdemen[sc]ional\b/gi, 'Dimensional'],
  [/\bdifferecibility\b/gi, 'Differentiability'],
  [/\bdifferencibility\b/gi, 'Differentiability'],
  [/\bdifferencial\b/gi, 'Differential'],
  [/\bacconta?n?cy\b/gi, 'Accountancy'],
  [/\bmedecine\b/gi, 'Medicine'],
  [/\bhaloakenes\b/gi, 'Haloalkanes'],
  [/\bhaloarens\b/gi, 'Haloarenes'],
  [/\balchohol\b/gi, 'Alcohol'],
  [/\bamins\b/gi, 'Amines'],
  [/\belectrochem\b/gi, 'Electrochemistry'],
  [/\beco\.?\b/gi, 'Economics'],
  [/\bpsyc\b/gi, 'Psychology'],
  [/\bbuisness\b/gi, 'Business'],
  [/\bcompt\b/gi, 'Competition'],
  [/\beqlb\b/gi, 'Equilibrium'],
  [/\bprodn\b/gi, 'Production'],
  [/\bansk\b/gi, 'Answer Key'],
  [/\bcalcuation\b/gi, 'Calculation'],
  [/\bcompelte\b/gi, 'Complete'],
  [/\bchemisty\b/gi, 'Chemistry'],
  [/\belectro\s+chem(?:istry)?\b/gi, 'Electrochemistry'],
  [/\bcoordination\s+chem(?:istry)?\b/gi, 'Coordination Chemistry'],
  [/\brevison\b/gi, 'Revision'],
  [/\bsuggestive\b/gi, 'Suggestive'],
  [/\bhaloalkens\b/gi, 'Haloalkanes'],
  [/\badditonal\b/gi, 'Additional'],
  [/\bacconta[c]?y\b/gi, 'Accountancy'],
  [/\belectrostate\b/gi, 'Electrostatics'],
  [/\bhuygene\b/gi, 'Huygens Principle'],
  [/\bderivationz\b/gi, 'Derivations'],
  [/\bmedecine\b/gi, 'Medicine'],
  [/\bprism\b/gi, 'Prism'],
];

const ACRONYMS = new Map([
  ['isc', 'ISC'],
  ['icse', 'ICSE'],
  ['sqp', 'SQP'],
  ['sqps', 'SQPs'],
  ['qp', 'QP'],
  ['pyq', 'PYQ'],
  ['pyqs', 'PYQs'],
  ['mcq', 'MCQ'],
  ['mcqs', 'MCQs'],
  ['hcg', 'HCG'],
  ['pcm', 'PCM'],
  ['ncert', 'NCERT'],
  ['bos', 'BOS'],
  ['cfq', 'CFQ'],
  ['hots', 'HOTS'],
  ['itf', 'ITF'],
  ['lpp', 'LPP'],
  ['mvt', 'MVT'],
  ['ak', 'Answer Key'],
  ['aiipt', 'AIIPT'],
  ['kisa', 'KISA'],
  ['dpsm', 'DPSM'],
  ['bsp', 'Board Support Paper'],
  ['sttv', 'STTV'],
  ['lmgs', 'LMGS'],
  ['hfs', 'HFS'],
  ['jml', 'JML'],
  ['cghs', 'CGHS'],
  ['wgs', 'WGS'],
  ['dbpc', 'DBPC'],
  ['pp', 'Practice Paper'],
  ['hy', 'Half Yearly'],
  ['qp', 'QP'],
  ['bsps', 'Board Support Papers'],
  ['xii', 'XII'],
  ['xi', 'XI'],
  ['x', 'X'],
  ['ix', 'IX'],
  ['ii', 'II'],
  ['iii', 'III'],
  ['iv', 'IV'],
  ['vi', 'VI'],
  ['vii', 'VII'],
  ['viii', 'VIII'],
  ['qa', 'Q&A'],
]);

const NOISE = [
  /\bpdf\b/gi,
  /-?\s*\bcopy\b/gi,
  /\bconverted\b/gi,
  /\bby\s*@?[\w.]+/gi,
  /@[\w.]+/g,
  /\b_?\d{6}_\d{6}\b/g,
  /\bscreenshot\b/gi,
  /\bdownloaded\b/gi,
  /\bwatermarked\b/gi,
  /\buf\b/gi,
  /\b\d{5,6}\s+\d{5,6}\b/g,
  /\b\d{6}\b/g,
  /\[([^\]]+)\]/g,
  /ilide\.info-?/gi,
  /\b[0-9a-f]{18,}\b/gi,
  /\b(85\d|86\d)\b/g,
];

/** Title-case shouting / snake_case names without mangling acronyms. */
function pretty(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(w => {
      const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (ACRONYMS.has(w.toLowerCase())) return ACRONYMS.get(w.toLowerCase());
      if (ACRONYMS.has(k) && k.length <= 4) return ACRONYMS.get(k);
      if (w === w.toUpperCase() && /[A-Z]{2,}/.test(w)) {
        return w
          .toLowerCase()
          .replace(/(^|[-/(&])([a-z])/g, (_, p, c) => p + c.toUpperCase());
      }
      return w;
    })
    .join(' ');
}

function cleanBase(filename) {
  let base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b(unit|ch|chapter|part|set|ex|lecture)(\d)/gi, '$1 $2');
  base = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  for (const n of NOISE) base = base.replace(n, ' ');
  base = base.replace(/\(\d+\)/g, ' ');
  base = base.replace(/^\d{1,2}\s*[.-]\s*/, '');
  base = base.replace(/\s+/g, ' ').trim();
  for (const [re, to] of FIXES) base = base.replace(re, to);
  base = base.replace(/\s+-\s+/g, ' - ').replace(/\s+/g, ' ').trim();
  return base;
}

const PUBLISHERS = [
  ['Oswal', /oswa+al/i],
  ['Arihant', /arihant/i],
  ['Goyal', /goyal/i],
  ['CB Gupta', /cb\s*gupta/i],
  ['Evergreen', /evergreen/i],
  ['Together With', /together with/i],
  ['Rachna Sagar', /rachna sagar/i],
  ['Meritnation', /meritnation/i],
  ['Vatsal', /vatsal/i],
  ['Shobhit Nirwan', /shobhit nirwan/i],
  ['PW', /\bpw\b/i],
  ['Educart', /educart/i],
  ['Nootan', /nootan/i],
];

const SUBJECT_WORDS =
  /\b(physics|phy|chemistry|chem|biology|bio|mathematics|maths|math|economics|economic|accountancy|accounts|commerce|computer science|computer|psychology|sociology|geography|geo|history|english|literature|business studies|business)\b/gi;

const CLASS_WORDS =
  /\b(class|xii|xi|xii th|12th|12|11th|11|std|grade|gr|g12|isc|icse|unit|chapter)\b/gi;

const TYPE_WORDS = {
  'Sample Paper': /sample\s*papers?/i,
  'Specimen Paper': /specimen(\s*paper)?/i,
  'Model Paper': /model\s*(test\s*)?paper/i,
  'Board Support Paper': /board support papers?/i,
  'Prelim Paper': /prelims?|pre[- ]?boards?|mock/i,
  'Past Paper': /\bpyqs?\b|previous year/i,
  'Question Bank': /question\s*bank/i,
  'MCQs': /\bmcqs?\b/i,
  'Worksheet': /worksheets?/i,
  'Formula Sheet': /formula(\s*sheet)?s?/i,
  'Revision Notes': /revision(\s*notes)?|short notes/i,
  'Diagram Sheet': /diagrams?(\s*sheet)?/i,
  'Derivation': /derivations?/i,
  'Syllabus': /syllabus/i,
  'Notes': /notes?/i,
  'Answer Key': /answer\s*keys?|\bak\b/i,
  'Most Probable Questions': /most probable|suggestions?/i,
  'Project File': /project/i,
  'Handbook': /handbook/i,
  'PYQ (Chapter-wise)': /chapter\s*wise/i,
};

/** Remove words the composed name already states, so nothing repeats. */
const TITLE_STOP = new Set([
  'a','an','and','as','at','by','for','from','in','into','of','on','or','the','to','vs','with','v','x','per','via',
]);

function titleWords(s) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const bare = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
      if (!bare) return w;
      const lower = bare.toLowerCase();
      if (ACRONYMS.has(lower)) return w.replace(bare, ACRONYMS.get(lower));
      if (i > 0 && TITLE_STOP.has(lower)) return w.replace(bare, lower);
      // Keep names with internal capitals or digits intact (CB, PYQs, 3D, 1.2).
      if (/[A-Z]/.test(bare.slice(1)) || /\d/.test(bare)) return w;
      return w.replace(bare, bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase());
    })
    .join(' ');
}

function sentenceCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stripDetail(detail, subject, type, publisher, topic) {
  let d = ` ${detail} `;
  const drop = (re) => {
    d = d.replace(re, ' ');
  };
  drop(new RegExp(SUBJECT_WORDS.source, 'gi'));
  drop(new RegExp(CLASS_WORDS.source, 'gi'));
  const tw = TYPE_WORDS[type];
  if (tw) drop(tw);
  if (topic) {
    // Only a leading run that repeats the topic, so "Banking percentage
    // booster" loses "Banking" but "Application of integration" survives.
    const topicWords = topic
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter(w => w.length > 2);
    const words = d.trim().split(/\s+/);
    const normWord = (w) => w.toLowerCase().replace(/[^a-z0-9+]/g, '');
    const STOP = new Set(['and', 'of', 'the', 'a', 'an', 'for', 'to', 'with', 'in', 'on', '&', '+', '-']);
    const hitsTopic = (w) => {
      const k = normWord(w);
      if (k.length < 3) return false;
      return topicWords.some(t => t.length > 2 && (k.startsWith(t) || t.startsWith(k)));
    };
    let i = 0;
    while (i < words.length && (hitsTopic(words[i]) || STOP.has(normWord(words[i])))) i++;
    const remainder = words.slice(i).filter(w => !STOP.has(normWord(w)));
    // Leave the phrase intact when trimming would strand a single word —
    // "Coordination compounds" is clearer than "Compounds".
    if (remainder.length >= 2 || words.length <= 2) d = ' ' + words.slice(i).join(' ') + ' ';
  }
  if (publisher) drop(new RegExp(publisher.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  d = d.replace(/[(),]/g, ' ').replace(/\s*[-–—]\s*$/g, '').replace(/\s+/g, ' ').trim();
  d = d.replace(/^(unit|ch|chapter)\s*\d+\s*[-.]?\s*/i, '');
  d = d.replace(/^\d{1,2}\s*[-.]\s*(?=[A-Za-z])/, '');
  d = d.replace(/^\d{1,2}\s+(?=[A-Za-z])/, '');
  d = d.replace(/^[-–—\s]+|[-–—\s]+$/g, '');
  // ISC subject codes (861 Physics, 853 Geography, ...) carry no meaning here.
  if (/^8[56]\d$/.test(d.trim())) return '';
  if (/^(and|of|the|a|an|to|for|with)$/i.test(d.trim())) return '';
  if (/^\d{1,3}$/.test(d.trim())) return `Part ${d.trim()}`;
  if (/^(studies|commerce|economics|papers|notes|science|accountancy)$/i.test(d.trim())) return '';
  // Detail that only restates the document type ("Revision Notes - Notes").
  const typeWords = type.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2);
  const detailWords = d.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (detailWords.length && detailWords.every(w => typeWords.includes(w))) return '';
  const bare = d.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (bare.length < 2) return '';
  // Wholly contained in the topic the name already states.
  if (topic && topic.toLowerCase().replace(/[^a-z0-9]/g, '').includes(bare)) return '';
  return titleWords(sentenceCase(pretty(d)));
}

/* ----------------------------------------------------------- name assembly */

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const EXT = (name) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'pdf').toLowerCase();

// Files whose own name is a sequence number inside a bulk folder.
function numbered(base, type, topic) {
  const m = base.match(/^(?:part|set|hlp)\s*[-–]?\s*(\d+)$/i);
  if (m) return { type, detail: `Part ${m[1]}` };
  const two = base.match(/^(\d{1,2})\s*-\s*(\w+)$/);
  if (two && type === 'Notes') return { type, detail: `Part ${two[2]}` };
  const n = base.match(/^(\d{1,3})$/);
  if (n) return { type, detail: `Paper ${n[1]}` };
  const der = base.match(/^(?:derivatives?|derivation)\s*[-–]?\s*(\d+)$/i);
  if (der && type === 'Derivation') return { type: 'Derivation', detail: `Set ${der[1]}` };
  const cs = base.match(/^(?:cs|isc)\s*(?:prelims?|practice paper)\s*(\d+)$/i);
  if (cs) return { type: 'Practice Paper', detail: `Practice Paper ${cs[1]}` };
  const bsp = base.match(/^bsp\s*[-–]?\s*(\d+)$/i);
  if (bsp) return { type: 'Board Support Paper', detail: `${bsp[1]}` };
  return null;
}

// Files whose own name carries no recoverable meaning; named by hand from the
// content they sit next to.
const OVERRIDES = new Map([
  ['Class_12_Biology_ALL_Important_Diagrams_at_One_Place_EKta_Soni_1.pdf', 'Biology - Diagram Sheet - All Important Diagrams.pdf'],
  ['CLASS XII ISC MAHAREVISION UNIT 5 ECOLOGY & ENVIRONMENT.pdf', 'Biology - Maha Revision - Unit V Ecology & Environment.pdf'],
  ['Class_12_ISC_Biology_2026_महा_Revision_Lecture_2_Reproduction_Unit.pdf', 'Biology - Maha Revision - Unit I Reproduction (Lecture 2).pdf'],
  ['CLASS_12_ISC_MAHA_REVISION_UNIT_II_GENETICS_&_EVOLUTION_Diagram+Sample.pdf', 'Biology - Maha Revision - Unit II Genetics & Evolution.pdf'],
  ['CLASS_XII_ISC_BIOLOGY_MAHAREVISION_UNIT_I_REPRODUCTIN_LECTURE_1.pdf', 'Biology - Maha Revision - Unit I Reproduction (Lecture 1).pdf'],
  ['CLASS_XII_ISC_MAHAREVISION_UNIT_4_BIOTECHNOLOGY_AND_ITS_APPLICATION.pdf', 'Biology - Maha Revision - Unit IV Biotechnology & Its Applications.pdf'],
  ['Maha_Revision_ONE_SHOT_Biology_&_Human_Welfare_Unit_III_Class_12.pdf', 'Biology - Maha Revision - Unit III Biology & Human Welfare.pdf'],
  ['HY_ECON_12_QP.pdf', 'Economics - Prelims Paper - DPSM Half Yearly QP.pdf'],
  ['HY23_ECON_12_QP.pdf', 'Economics - Prelims Paper - DPSM Half Yearly QP (2023).pdf'],
  ['QP12_HY24_Final.pdf', 'Economics - Prelims Paper - DPSM Half Yearly QP (2024).pdf'],
  ['ilide.info-macbeth-act-4-scene-3-isc-class-12-workbook-answers-pr_ebe47f12a5324a6c28547081477efab1.pdf', 'Literature in English - Macbeth - Act 4 Scene 3 Workbook Answers.pdf'],
  ['ilide.info-macbeth-act-5-questions-pr_70f25812f960ffd35e6eff0899725af2.pdf', 'Literature in English - Macbeth - Act 5 Questions.pdf'],
  ['What is Stack Data Structure? A Complete Tutorial - GeeksforGeeks.pdf', 'Computer Science - Section C — Java - Notes - Stack Data Structure.pdf'],
  ['Queue Data Structure- Types, Implementation, Applications - Shiksha Online.pdf', 'Computer Science - Section C — Java - Notes - Queue Data Structure.pdf'],
  ['3d-1.pdf', 'Mathematics - 3D Geometry - Notes - Part 1.pdf'],
  ['ISC_Batch26_Physics_Syllabus_Derivations_Highlighted.pdf', 'Physics - Syllabus - Derivation List (ISC 2026).pdf'],
]);

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const review = [];
const drops = [];
// Two dedupe layers: identical uploads (same source name modulo "(1)"/"- Copy")
// are dropped, while different files that normalise to the same display name
// are kept with a counter suffix instead of silently disappearing.
const seenSource = new Map();
const usedNames = new Map();
const normSource = (n) =>
  n
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/\(\d+\)/g, '')
    .replace(/\bcopy\b/g, '')
    .replace(/[^a-z0-9]/g, '');
const out = new Map();
const trees = new Map();

function push(subject, group, item, topic) {
  const bySubject = out.get(subject) ?? new Map();
  out.set(subject, bySubject);
  const items = bySubject.get(group) ?? [];
  bySubject.set(group, items);
  items.push({ ...item, group });
  if (topic) {
    const t = trees.get(subject) ?? new Map();
    trees.set(subject, t);
    const g = t.get(group) ?? new Map();
    t.set(group, g);
    const list = g.get(topic) ?? [];
    g.set(topic, list);
    list.push({ ...item, group });
  }
}

for (const src of raw) {
  const fileName = src.fullFileName || `${src.title}.pdf`;

  if (src.subject === 'Biology' && /^Vatsal Resources/.test(src.category ?? '')) {
    drops.push({ reason: 'duplicate of the Chemistry Vatsal set', fileName, id: src.driveId });
    continue;
  }

  if (/\.ds_store$/i.test(fileName)) {
    drops.push({ reason: 'not a resource', fileName, id: src.driveId });
    continue;
  }

  const ext = EXT(fileName);
  const overrideName = OVERRIDES.get(fileName) ?? null;

  // A human-checked name wins over anything the rules can infer.
  const reviewed = REVIEWED[src.driveId];
  if (reviewed) {
    const rBase = SUBJECT[src.subject] ?? src.subject;
    const rSubject =
      reviewed.subject ??
      (rBase === 'English Language' && ENGLISH_PAPER_2.test(`${src.category ?? ''} ${fileName}`)
        ? 'Literature in English'
        : rBase);
    const ext2 = EXT(reviewed.name);
    const srcKey = `${rSubject}|${normSource(fileName)}`;
    if (!seenSource.has(srcKey)) seenSource.set(srcKey, src.driveId);
    const display = uniqueName(rSubject, reviewed.name);
    const topic = reviewed.group === 'Chapter Notes' ? chapterTopic(display, rSubject) : null;
    push(rSubject, reviewed.group, item(display, ext2, src), topic);
    continue;
  }
  const base = cleanBase(fileName);
  const category = src.category ?? '';

  const subjectBase = SUBJECT[src.subject] ?? src.subject;
  const subject =
    subjectBase === 'English Language' && ENGLISH_PAPER_2.test(`${category} ${fileName}`)
      ? 'Literature in English'
      : subjectBase;

  const strongType = /syllabus/i.test(base)
    ? 'Syllabus'
    : /\bcfq\b/i.test(base)
      ? 'Question Bank'
      : null;

  let type =
    strongType ??
    CATEGORY_TYPE[category] ??
    DOC_RULES.find(r => r.re.test(`${base} ${category}`))?.type ??
    (src.tag === 'Practice / CFQ' ? 'Practice Questions' : src.tag === 'PYQ / Specimen' ? 'Question Paper' : 'Notes');
  let detail = base;
  let brand = null;
  if (/percentage[_ ]booster/i.test(base)) {
    brand = 'Percentage Booster';
    detail = base.replace(/percentage[_ ]booster/gi, ' ').replace(/\s+/g, ' ').trim();
  }

  const pub = PUBLISHERS.find(([, re]) => re.test(base));

  // Numbered bulk files ("Part-11", "BSP 4", "Derivatives 3").
  const numberedCase = numbered(base, type);
  if (numberedCase) type = numberedCase.type;

  const pin = CATEGORY[`${src.subject}::${category}`];

  let group;
  let topic = null;

  if (typeof pin === 'string' && pin.startsWith(':PRELIMS:')) {
    group = `PYQ Prelims · ${pin.slice(9)}`;
    const body = titleWords(sentenceCase(pretty(base)));
    let display =
      overrideName ?? `${dedupeParts([subject, 'Prelims Paper', body])}.${ext}`.replace(/\.pdf\.pdf$/i, '.pdf');
    const srcKey = `${subject}|${normSource(fileName)}`;
    if (seenSource.has(srcKey)) {
      drops.push({ reason: 'duplicate', fileName, id: src.driveId, kept: seenSource.get(srcKey) });
      continue;
    }
    seenSource.set(srcKey, src.driveId);
    display = uniqueName(subject, display);
    push(subject, group, item(display, ext, src), null);
    continue;
  }

  if (typeof pin === 'string' && pin.startsWith(':GROUP:')) {
    group = pin.slice(7);
  } else {
    topic = pin === undefined ? null : pin;
    group = groupFor(type);
  }

  const norm = (v) => v.toLowerCase().replace(/[^a-z]/g, '');
  const topicDuplicatesType =
    topic && norm(topic).slice(0, 3) === norm(type).slice(0, 3) && norm(topic).slice(0, 3).length === 3;
  const parts = [subject];
  if (topic && !topicDuplicatesType) parts.push(topic);
  parts.push(type);

  if (numberedCase) {
    if (numberedCase.detail) parts.push(numberedCase.detail);
  } else {
    const d = stripDetail(detail, subject, type, pub?.[0], topic);
    if (d && d.toLowerCase() !== type.toLowerCase()) parts.push(d);
  }
  if (pub && !parts.join(' ').toLowerCase().includes(pub[0].toLowerCase())) parts.push(pub[0]);
  if (brand) parts.push(brand);

  let display = overrideName ?? `${dedupeParts(parts)}${ext === 'pdf' ? '.pdf' : '.' + ext}`;
  const srcKey = `${subject}|${normSource(fileName)}`;
  if (seenSource.has(srcKey)) {
    drops.push({ reason: 'duplicate', fileName, id: src.driveId, kept: seenSource.get(srcKey) });
    continue;
  }
  seenSource.set(srcKey, src.driveId);
  display = uniqueName(subject, display);

  // Flag files whose own name says nothing about the content — those are the
  // ones worth a human look.
  const bareName = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ').trim();
  const meaningful = /notes?|paper|specimen|sample|question|bank|formula|worksheet|revision|syllabus|pattern|booklet|chapter|theory|pyq|mcq|notes|guide|handbook|diagram|answer|solution/i.test(bareName);
  const segments = display.replace(/\.\w+$/, '').split(' - ');
  const tail = segments[segments.length - 1] ?? '';
  const thinTail = tail.replace(/[^A-Za-z0-9]/g, '').length <= 12 && !/\d/.test(tail);
  if (!meaningful && thinTail) {
    review.push({ id: src.driveId, fileName, subject, proposed: display });
  }

  push(subject, group, item(display, ext, src), group === 'Chapter Notes' ? (topic ?? 'General') : null);
}

// "Mathematics - Determinants - Notes.pdf" -> "Determinants"
function chapterTopic(display, subject) {
  const parts = display.replace(/\.[a-z0-9]+$/i, '').split(' - ');
  for (let i = 1; i < parts.length; i++) {
    if (!NON_TOPIC.has(parts[i])) return parts[i];
  }
  return 'General';
}

// Clean up rule-generated names: collapse a repeated type segment, drop a
// dangling connector ("... Importance of Finance for - Percentage Booster")
// and squash a detail that just repeats the type ("Board Support Paper -
// Board Support Paper 4").

function tidyName(display) {
  const ext = display.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const parts = display.slice(0, display.length - ext.length).split(' - ').map(p => p.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const words = part
      .replace(/\b[0-9a-f]{8}(?: [0-9a-f]{4}){3} [0-9a-f]{12}\b/gi, ' ')
      .replace(/\b[0-9a-f]{16,}\b/gi, ' ')
      .split(/\s+/)
      .filter(Boolean);
    while (words.length > 1 && STOP_TAIL.has(words[words.length - 1].toLowerCase())) words.pop();
    const cleaned = words.join(' ').trim();
    if (!cleaned) continue;
    if (out.length) {
      const prev = out[out.length - 1].toLowerCase();
      const cur = cleaned.toLowerCase();
      if (prev === cur) continue;
      // "Board Support Paper" + "Board Support Paper 4" -> keep the longer one
      // "Obsession Handbook - Handbook" -> the shorter word is already inside
      if (prev.endsWith(` ${cur}`) || prev === cur) continue;
      const sing = (v) => v.replace(/s$/, '');
      if (cur.startsWith(`${prev} `) || cur.startsWith(`${sing(prev)}s `)) { out[out.length - 1] = cleaned; continue; }
      if (prev.startsWith(`${cur} `) || prev.startsWith(`${sing(cur)}s `)) continue;
    }
    out.push(cleaned);
  }
  return out.join(' - ') + ext;
}

function uniqueName(subject, display) {
  display = tidyName(display);
  const key = (n) => `${subject}|${n.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (!usedNames.has(key(display))) {
    usedNames.set(key(display), 1);
    return display;
  }
  let n = 2;
  let candidate = display;
  while (usedNames.has(key(candidate))) {
    candidate = display.replace(/(\.[a-z0-9]+)$/i, ` (${n})$1`);
    n++;
  }
  usedNames.set(key(candidate), 1);
  return candidate;
}

function item(name, ext, src) {
  return {
    name,
    id: src.driveId,
    group: '',
    type: 'file',
    mimeType: MIME[ext] ?? 'application/octet-stream',
    createdTime: null,
    modifiedTime: null,
    size: null,
    originalName: src.fullFileName || null,
  };
}

function groupFor(type) {
  switch (type) {
    case 'Sample Paper':
    case 'Specimen Paper':
    case 'Model Paper':
      return 'Sample & Specimen Papers';
    case 'Past Paper':
    case 'PYQ (Chapter-wise)':
      return 'PYQ Papers';
    case 'Question Bank':
    case 'MCQs':
    case 'Worksheet':
    case 'Practice Questions':
    case 'Important Questions':
    case 'Answer Key':
      return 'Question Banks';
    case 'Formula Sheet':
    case 'Revision Notes':
      return 'Quick Revision';
    case 'Syllabus':
    case 'Paper Pattern':
      return 'Syllabus & Pattern';
    case 'Prelim Paper':
      return 'Prelims';
    case 'Question Paper':
      return 'Sample & Specimen Papers';
    case 'Board Support Paper':
      return 'Board Support Papers';
    case 'Most Probable Questions':
      return 'Most Probable Questions';
    case 'Project File':
      return 'Project';
    case 'Handbook':
      return 'Handbooks';
    default:
      return 'Chapter Notes';
  }
}

function dedupeParts(parts) {
  const seenTok = new Set();
  return parts
    .map(p => p.replace(/^[\s.,:;\-–—]+|[\s.,:;\-–—]+$/g, ''))
    .filter(p => {
      const k = p.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || seenTok.has(k)) return false;
      seenTok.add(k);
      return true;
    })
    .join(' - ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ output */

const GROUP_ORDER = [
  'Chapter Notes',
  'Quick Revision',
  'Question Banks',
  'Sample & Specimen Papers',
  'PYQ Papers',
  'Board Support Papers',
  'Most Probable Questions',
  'Syllabus & Pattern',
  'Handbooks',
  'Project',
];

const subjects = [...out.keys()].sort().map(subject => {
  const groups = out.get(subject);
  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.startsWith('PYQ Prelims') ? 1 : -1;
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const items = ordered.flatMap(g => groups.get(g));
  const entry = { subject, items };

  const notesTree = trees.get(subject)?.get('Chapter Notes');
  if (notesTree && notesTree.size > 1) {
    entry.editorFolders = [...notesTree.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([topic, list]) => ({
        type: 'folder',
        name: topic,
        children: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }));
    entry.editorFoldersGroup = 'Chapter Notes';
    // A folder-nav group renders the tree instead of its loose items, so keep
    // the files in exactly one place — otherwise the manifest double-counts.
    entry.items = entry.items.filter(i => i.group !== 'Chapter Notes');
  }
  return entry;
});

const dataset = {
  generatedAt: new Date().toISOString(),
  attribution: {
    label: 'Indexed from the ISC.exe 2.0 community directory',
    url: 'https://class-12-isc.vercel.app/#/notes',
    note: 'Files are hosted by their original contributors on Google Drive; Lambda Prep renames and organises the index only.',
  },
  subjects,
  misc: [],
};

fs.writeFileSync(OUT, JSON.stringify(dataset));

const total = subjects.reduce((a, s) => a + s.items.length, 0);
console.log(`subjects: ${subjects.length}  items: ${total}  review: ${review.length}  dropped: ${drops.length}`);

if (process.argv.includes('--csv')) {
  fs.mkdirSync(path.dirname(REVIEW), { recursive: true });
  const rows = [['status', 'drive_id', 'subject_or_reason', 'source_filename', 'proposed_name', 'your_name']];
  for (const r of review) rows.push(['needs_name', r.id, r.subject, r.fileName, r.proposed, '']);
  for (const d of drops) rows.push([`dropped - ${d.reason}`, d.id ?? '', '', d.fileName, d.kept ?? '', '']);
  fs.writeFileSync(REVIEW, rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'));
  console.log(`review sheet: ${REVIEW} (${review.length} to name, ${drops.length} dropped)`);
}

if (process.argv.includes('--dump')) {
  for (const s of subjects) {
    console.log(`\n### ${s.subject}`);
    for (const i of s.items) console.log(`  [${i.group}] ${i.name}`);
  }
  console.log('\n### DROPPED');
  for (const d of drops) console.log(`  ${d.reason}: ${d.fileName}`);
}
