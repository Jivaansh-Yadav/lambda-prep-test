#!/usr/bin/env python3
"""Transform CISCE Resources + Study Materials Google-Drive trees into
subject-bucketed resource lists for ICSE Class 10, consumed by the Lambda
Prep resources UI. Produces two JSON files:
  src/data/resources-cisce-icse-10.json
  src/data/resources-community-icse-10.json
Each has shape: { subjects: [{ subject, items: [{name, id, group}] }], misc: [...] }
Only content with a clear subject header (folder/filename matching one of the
site's 10 canonical ICSE Class 10 subjects) is bucketed under that subject.
Everything else (loose files, non-subject folders like Commercial Studies /
Economics / Economic Applications, unmatched Prelims papers) goes to `misc`.
"""
import json, re

CISCE_SRC = '/workspace/plans/drive-crawl/output/cisce-resources.json'
STUDY_SRC = '/workspace/plans/drive-crawl/output/study-materials.json'

# Canonical subject names used across the Lambda Prep site for ICSE Class 10
# (matches curriculum.json / lambda.ts subjects filtered for ICSE, non-iscOnly).
SUBJECTS = [
    'Biology', 'Chemistry', 'Commercial Applications', 'Computer Applications',
    'English Language', 'English Literature', 'Geography', 'Hindi', 'History & Civics', 'Mathematics', 'Physics',
]

# ---------------------------------------------------------------------------
# CISCE Resources: paper/exam codes used in filenames
# ---------------------------------------------------------------------------
CODE_TO_SUBJECT = {
    'BIO': ['Biology'], 'CHE': ['Chemistry'], 'CSA': ['Computer Applications'],
    'GEO': ['Geography'], 'HIN': ['Hindi'], 'HIS': ['History & Civics'],
    'LAN': ['English Language'], 'LIT': ['English Literature'],
    'MAT': ['Mathematics'], 'PHY': ['Physics'],
    'SCI': ['Physics', 'Chemistry', 'Biology'],
    'ENG': ['English Language'], 'ENG1': ['English Language'], 'ENG2': ['English Literature'],
    'HCG': ['History & Civics', 'Geography'],
    'HCG1': ['History & Civics'], 'HCG2': ['Geography'],
    'SCI1': ['Physics'], 'SCI2': ['Chemistry'], 'SCI3': ['Biology'],
    'CTA': ['Computer Applications'], 'CAS': ['Commercial Applications'],
}
NAME_TOKENS = [
    (re.compile(r'english[\s_-]*language', re.I), ['English Language']),
    (re.compile(r'literature[\s_-]*in[\s_-]*english', re.I), ['English Literature']),
    (re.compile(r'history[\s_-]*(and|&)?[\s_-]*civics', re.I), ['History & Civics']),
    (re.compile(r'computer[\s_-]*application', re.I), ['Computer Applications']),
    (re.compile(r'commercial[\s_-]*application', re.I), ['Commercial Applications']),
    (re.compile(r'\bbiology\b', re.I), ['Biology']),
    (re.compile(r'\bchemistry\b', re.I), ['Chemistry']),
    (re.compile(r'\bgeography\b', re.I), ['Geography']),
    (re.compile(r'\bhindi\b', re.I), ['Hindi']),
    (re.compile(r'mathematics|\bmaths\b', re.I), ['Mathematics']),
    (re.compile(r'\bphysics\b', re.I), ['Physics']),
    # Bare "English" (no Language/Literature qualifier) covers combined
    # syllabus docs etc.; default to English Language.
    (re.compile(r'\benglish\b', re.I), ['English Language']),
]
# Word-boundary via lookaround (not \b) so codes glued to digits on either
# side still match, e.g. "521SCI", "051HIN1", "861CTA1".
CODE_RE = re.compile(r'(?<![A-Za-z])(APF-)?(BIO|CHE|CSA|GEO|HIN|HIS|LAN|LIT|MAT|PHY|SCI1|SCI2|SCI3|SCI|ENG1|ENG2|ENG|HCG1|HCG2|HCG|CTA|CAS)(?![A-Za-z])', re.I)

def match_subjects_cisce(name: str):
    for tok, subs in NAME_TOKENS:
        if tok.search(name):
            return subs
    m = CODE_RE.search(name)
    if m:
        code = m.group(2).upper()
        if code in CODE_TO_SUBJECT:
            return CODE_TO_SUBJECT[code]
    return None


def load(path):
    with open(path) as f:
        return json.load(f)


def build_folder_node(node, group_label):
    """Convert a raw Drive folder-tree node into the {type:'folder', name,
    children} shape consumed by the Lambda Prep UI's recursive folder
    navigator. Folders sort before files (already true in the Drive crawl
    output); files carry `group` set to the given label (the originating
    top-level folder name) so existing group-based UI logic still works if
    ever flattened."""
    children = []
    for c in node.get('children', []):
        if c.get('type') == 'folder':
            children.append(build_folder_node(c, group_label))
        elif c.get('id'):
            children.append({'name': c['name'], 'id': c['id'], 'group': group_label, **meta_of(c)})
    return {'type': 'folder', 'name': node['name'], 'children': children}


def meta_of(node):
    return {
        'mimeType': node.get('mimeType'),
        'createdTime': node.get('createdTime'),
        'modifiedTime': node.get('modifiedTime'),
        'size': node.get('size'),
    }


def walk_files(node, prefix=()):
    if node.get('type') == 'file':
        yield node['name'], node.get('id'), prefix, meta_of(node)
        return
    for c in node.get('children', []):
        if c.get('type') == 'file':
            yield c['name'], c.get('id'), prefix, meta_of(c)
        else:
            yield from walk_files(c, prefix + (c['name'],))


def build_cisce():
    data = load(CISCE_SRC)
    buckets = {s: [] for s in SUBJECTS}
    misc = []
    for name, fid, path, meta in walk_files(data):
        if not fid:
            continue
        subs = match_subjects_cisce(name)
        type_label = path[0] if path else 'Other'
        year = path[-1] if len(path) > 1 and re.match(r'^\d{4}', path[-1]) else None
        group = f'{type_label} · {year}' if year else type_label
        item = {'name': name, 'id': fid, 'group': group, **meta}
        if subs:
            for s in subs:
                buckets[s].append(dict(item))
        else:
            misc.append(dict(item, group=type_label))
    subjects_out = [{'subject': s, 'items': items} for s, items in buckets.items() if items]
    return {'subjects': subjects_out, 'misc': misc}


# ---------------------------------------------------------------------------
# Study Materials (Community): top-level folders already carry subject names.
# ---------------------------------------------------------------------------
STUDY_TOP_TO_SUBJECT = {
    'Biology': 'Biology', 'Chemistry': 'Chemistry',
    'Commercial Applications': 'Commercial Applications',
    'Computer Applications': 'Computer Applications',
    'English': 'English Language',
    'English Language': 'English Language',
    'English Literature': 'English Literature',
    'Geography': 'Geography', 'Hindi': 'Hindi',
    'History & Civics': 'History & Civics',
    'Maths': 'Mathematics', 'Physics': 'Physics',
}

# Folder-name keyword matcher used for the messy "PYQ Prelims" subtree, where
# subject headers appear at varying depths with inconsistent casing/spelling.
# Order matters: more specific patterns first; Physical Education must be
# excluded before the loose "phy" test could ever misfire (we don't use a
# bare 'phy' token at all, only 'physics', so PE is naturally safe).
PRELIM_FOLDER_PATTERNS = [
    (re.compile(r'physical[\s_-]*education|\bPE\b', re.I), None),  # explicit exclude
    (re.compile(r'biology', re.I), 'Biology'),
    (re.compile(r'chemistry', re.I), 'Chemistry'),
    (re.compile(r'commercial[\s_-]*application|\bCA\d|\bCAS\b', re.I), 'Commercial Applications'),
    (re.compile(r'commercial[\s_-]*stud|\bCS\d|comstudies', re.I), 'Commercial Studies'),
    (re.compile(r'computer|\bCTA\b', re.I), 'Computer Applications'),
    (re.compile(r'econom|\bEC\d', re.I), 'Economics'),
    (re.compile(r'english[\s_-]*lang|english-?1\b|\bELAN\b|\bENG1\b', re.I), 'English Language'),
    (re.compile(r'english[\s_-]*lit|english-?2\b|\bELIT\b|\bENG2\b', re.I), 'English Literature'),
    (re.compile(r'english', re.I), 'English Language'),
    (re.compile(r'geography', re.I), 'Geography'),
    (re.compile(r'hindi', re.I), 'Hindi'),
    (re.compile(r'hist(ory)?.*civics|civics.*hist(ory)?|\bHCG\b', re.I), 'History & Civics'),
    (re.compile(r'history', re.I), 'History & Civics'),
    (re.compile(r'math(s|ematics)?', re.I), 'Mathematics'),
    (re.compile(r'physics|\bPHY\b', re.I), 'Physics'),
]


def match_prelim_folder(name: str):
    for pat, subject in PRELIM_FOLDER_PATTERNS:
        if pat.search(name):
            return subject  # may be None (explicit exclude), caller checks membership
    return 'UNRESOLVED'


# Last-resort filename-abbreviation matcher applied to whatever is still in
# `misc` after the normal folder-based walk. Catches files whose subject is
# only hinted at by a short abbreviation in the filename itself (no subject
# folder ancestor at all), e.g. "...Lang...", "...Eng Gram...", "ECO...",
# "CHEM...", "...CA...", "...CS...". Uses (?<![A-Za-z])...(?![A-Za-z]) so the
# token isn't glued to other letters (digits on either side are fine, as in
# CODE_RE above). Order matters: more specific/longer tokens first.
MISC_FILENAME_PATTERNS = [
    (re.compile(r'eng(lish)?[\s_-]*lit(erature)?\b|(?<![A-Za-z])elit(?![A-Za-z])|literature|(?<![A-Za-z])lit(?![A-Za-z])|eng[\s_.-]*2\b|\bENG-2\b', re.I), 'English Literature'),
    (re.compile(r'eng(lish)?[\s_-]*gram|(?<![A-Za-z])gram(?![A-Za-z])|(?<![A-Za-z])lang(?![A-Za-z])|language|elang|eng[\s_.-]*1\b|\biang\b|\bENG\b', re.I), 'English Language'),
    (re.compile(r'(?<![A-Za-z])chem(?![A-Za-z])', re.I), 'Chemistry'),
    (re.compile(r'(?<![A-Za-z])bio(?![A-Za-z])', re.I), 'Biology'),
    (re.compile(r'(?<![A-Za-z])geog(?![A-Za-z])|\bgeo[\s_.]*term\b', re.I), 'Geography'),
    (re.compile(r'hist[\s_-]*/?[\s_-]*civic|(?<![A-Za-z])hist(?![A-Za-z])', re.I), 'History & Civics'),
    (re.compile(r'(?<![A-Za-z])comp[\s_-]*app(?![A-Za-z])', re.I), 'Computer Applications'),
    (re.compile(r'(?<![A-Za-z])eco(?![A-Za-z])', re.I), 'Economics'),
    (re.compile(r'commercial[\s_-]*app|comm[\s_.-]*app(?![A-Za-z])|(?<![A-Za-z])ca(?![A-Za-z])', re.I), 'Commercial Applications'),
    (re.compile(r'commercial[\s_-]*stud|comm[\s_.-]*stud|commstudy|(?<![A-Za-z])cs(?![A-Za-z])', re.I), 'Commercial Studies'),
]


def match_misc_filename(name: str):
    for pat, subject in MISC_FILENAME_PATTERNS:
        if pat.search(name):
            return subject
    return None


def walk_prelims(node, active_subject, top_label, misc_pyq, buckets):
    """Depth-first walk assigning files to the nearest resolved subject
    ancestor folder; unresolved files fall into misc_pyq.

    active_subject is one of: a subject name (resolved ancestor folder),
    'EXCLUDED' (an ancestor folder matched an explicit exclude, e.g.
    Physical Education — never fall back to filename matching under it),
    or None (no subject-named ancestor folder was seen yet — a loose file
    here may still be matched by its own filename, e.g. "17-18 X Biology
    Euro School" sitting directly under a plain "YEAR 2017-18" folder)."""
    for c in node.get('children', []):
        if c.get('type') == 'file':
            fid = c.get('id')
            if not fid:
                continue
            meta = meta_of(c)
            subject = active_subject if active_subject in buckets else None
            if subject is None and active_subject is None:
                fallback = match_prelim_folder(c['name'])
                if fallback not in ('UNRESOLVED', None) and fallback in buckets:
                    subject = fallback
            if subject:
                buckets[subject].append({'name': c['name'], 'id': fid, 'group': f'PYQ Prelims · {top_label}', **meta})
            else:
                misc_pyq.append({'name': c['name'], 'id': fid, 'group': f'PYQ Prelims · {top_label}', **meta})
        else:
            resolved = match_prelim_folder(c['name'])
            if resolved == 'UNRESOLVED':
                next_subject = active_subject
            elif resolved is None:
                next_subject = 'EXCLUDED'
            else:
                next_subject = resolved
            walk_prelims(c, next_subject, top_label, misc_pyq, buckets)


def build_community():
    data = load(STUDY_SRC)
    buckets = {s: [] for s in SUBJECTS}
    misc = []
    pyq_misc = []
    # Loose top-level files and non-canonical top-level folders (Commercial
    # Studies, Economics, Economic Applications, ...) become their own
    # subject buckets, not misc — the live site surfaces them as extra
    # subject cards ("Featured" for loose files, folder name otherwise).
    extra_buckets: dict[str, list] = {
        'Commercial Studies': [], 'Economics': [], 'Economic Applications': [],
    }
    # walk_prelims resolves subject names via PRELIM_FOLDER_PATTERNS, which
    # now also covers Commercial Studies / Economics; it needs a single dict
    # of all buckets (canonical + extra) to append into directly.
    all_buckets = {**buckets, **extra_buckets}

    for top in data.get('children', []):
        name = top.get('name', '').strip()
        if top.get('type') == 'file':
            extra_buckets.setdefault('Featured', []).append(
                {'name': top['name'], 'id': top.get('id'), 'group': 'Featured', **meta_of(top)})
            continue
        if name == 'PYQ Prelims':
            for source in top.get('children', []):
                if source.get('type') == 'file':
                    pyq_misc.append({'name': source['name'], 'id': source.get('id'), 'group': 'PYQ Prelims', **meta_of(source)})
                    continue
                walk_prelims(source, None, source['name'].strip(), pyq_misc, all_buckets)
            continue
        subject = STUDY_TOP_TO_SUBJECT.get(name)
        if subject is None:
            # Non-canonical top-level folder (Commercial Studies, Economics,
            # Economic Applications, ...) -> its own subject bucket, named
            # after the folder, with files grouped by their immediate parent
            # folder name (matching the canonical-subject grouping below).
            bucket = extra_buckets.setdefault(name, [])
            for fname, fid, fpath, meta in walk_files(top, ()):
                if not fid:
                    continue
                group = fpath[-1] if fpath else 'General'
                bucket.append({'name': fname, 'id': fid, 'group': group, **meta})
            continue
        # Folders promoted to recursive "Editor's Choice" folder-cards (handled
        # separately below via build_folder_node) must be excluded from the
        # flat group listing here, or their content would be duplicated.
        editor_folder_names = {
            'English Literature': {'Julius Caesar', 'Treasure Chest'},
            'English Language': {'Study With Sudhir - Resources'},
        }.get(name, set())
        top_for_walk = top
        if editor_folder_names:
            top_for_walk = dict(top, children=[
                c for c in top.get('children', [])
                if not (c.get('type') == 'folder' and c.get('name') in editor_folder_names)
            ])
        if name == 'English':
            # Split into "English Language" / "English Literature" subjects so
            # each links to its own folder (Language vs Literature/*).
            lang_bucket = []
            lit_bucket = []
            for fname, fid, fpath, meta in walk_files(top_for_walk, ()):
                if not fid:
                    continue
                if fpath and fpath[0] == 'Literature':
                    rest = fpath[1:]
                    group = rest[-1] if rest else 'General'
                    lit_bucket.append({'name': fname, 'id': fid, 'group': group, **meta})
                else:
                    rest = fpath[1:] if fpath and fpath[0] == 'Language' else fpath
                    group = rest[-1] if rest else 'General'
                    lang_bucket.append({'name': fname, 'id': fid, 'group': group, **meta})
            buckets.setdefault('English Language', [])
            buckets.setdefault('English Literature', [])
            buckets['English Language'].extend(lang_bucket)
            buckets['English Literature'].extend(lit_bucket)
            continue
        for fname, fid, fpath, meta in walk_files(top_for_walk, ()):
            if not fid:
                continue
            group = fpath[-1] if fpath else 'General'
            buckets[subject].append({'name': fname, 'id': fid, 'group': group, **meta})

    # Last-resort pass: anything still in misc gets one more chance to be
    # matched via filename abbreviations (lang/gram, eco, chem, ca, cs).
    bucket_lookup = {**buckets, **extra_buckets}
    remaining_misc = []
    for item in misc + pyq_misc:
        subject = match_misc_filename(item['name'])
        if subject and subject in bucket_lookup:
            bucket_lookup[subject].append(item)
        else:
            remaining_misc.append(item)

    subjects_out = [{'subject': s, 'items': items} for s, items in buckets.items() if items]
    subjects_out.extend({'subject': s, 'items': items} for s, items in extra_buckets.items() if items)

    # Attach recursive "Editor's Choice" folder cards for English Literature
    # (Julius Caesar, Treasure Chest) and English Language (Study With Sudhir)
    # so the UI can render them as folder-navigable cards instead of flat files.
    editor_folders_by_subject: dict[str, list] = {}
    for top in data.get('children', []):
        name = top.get('name', '').strip()
        if name == 'English Literature':
            for c in top.get('children', []):
                if c.get('type') == 'folder' and c.get('name') in ('Julius Caesar', 'Treasure Chest'):
                    editor_folders_by_subject.setdefault('English Literature', []).append(
                        build_folder_node(c, 'General'))
        if name == 'English Language':
            for c in top.get('children', []):
                if c.get('type') == 'folder' and c.get('name') == 'Study With Sudhir - Resources':
                    editor_folders_by_subject.setdefault('English Language', []).append(
                        build_folder_node(c, 'General'))
    for s in subjects_out:
        folders = editor_folders_by_subject.get(s['subject'])
        if folders:
            s['editorFolders'] = folders

    return {'subjects': subjects_out, 'misc': remaining_misc}


if __name__ == '__main__':
    cisce = build_cisce()
    community = build_community()

    with open('/workspace/project/src/data/resources-cisce-icse-10.json', 'w') as f:
        json.dump(cisce, f, ensure_ascii=False)
    with open('/workspace/project/src/data/resources-community-icse-10.json', 'w') as f:
        json.dump(community, f, ensure_ascii=False)

    print('CISCE subjects:', [(s['subject'], len(s['items'])) for s in cisce['subjects']])
    print('CISCE misc:', len(cisce['misc']))
    print('Community subjects:', [(s['subject'], len(s['items'])) for s in community['subjects']])
    print('Community misc:', len(community['misc']))
