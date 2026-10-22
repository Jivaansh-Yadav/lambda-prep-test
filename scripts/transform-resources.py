#!/usr/bin/env python3
"""Transform the unified Lambda Prep Google-Drive crawl (scripts/drive-crawl/
output/<class>/{cisce,community}.json, scripts/drive-crawl/output/
doxxmarks.json) into the per-class subject-bucketed resource JSON consumed
by the Lambda Prep resources UI, plus Doxxmarks chapter revision notes.

Produces, for every class with crawl output present (icse-9, icse-10,
isc-11, isc-12):
  src/data/resources-cisce-<class>.json
  src/data/resources-community-<class>.json
Each has shape: { subjects: [{ subject, items: [{name, id, group, ...}],
                                editorFolders?: [...] }], misc: [...] }

Also rewrites src/data/curriculum.json's chapter-level `revisionNotes` from
scripts/drive-crawl/output/doxxmarks.json (InstaRevision chapter PDFs),
matching chapters by (board, class roman, subject, chapter name).

Only content with a clear subject header (folder/filename matching one of
the class's own canonical subjects) is bucketed under that subject.
Everything else goes to `misc`.

Usage:
  python3 scripts/transform-resources.py
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CRAWL_DIR = os.path.join(ROOT, 'scripts', 'drive-crawl', 'output')
DATA_DIR = os.path.join(ROOT, 'src', 'data')
CURRICULUM_PATH = os.path.join(DATA_DIR, 'curriculum.json')

CLASS_SLUGS = ['icse-9', 'icse-10', 'isc-11', 'isc-12']
BOARD_ROMAN_BY_SLUG = {
    'icse-9': ('ICSE', 'IX'), 'icse-10': ('ICSE', 'X'),
    'isc-11': ('ISC', 'XI'), 'isc-12': ('ISC', 'XII'),
}

# ---------------------------------------------------------------------------
# Canonical subject names per board, matching src/lib/lambda.ts / curriculum.json.
# ---------------------------------------------------------------------------
ICSE_SUBJECTS = [
    'Biology', 'Chemistry', 'Commercial Applications', 'Commercial Studies',
    'Computer Applications', 'Economic Applications', 'Economics',
    'English Language', 'Literature in English', 'Geography', 'Hindi',
    'History & Civics', 'Mathematics', 'Physics',
]
ISC_SUBJECTS = [
    'Accountancy', 'Biology', 'Business Studies', 'Chemistry', 'Commerce',
    'Computer Science', 'Economics', 'English Language', 'Environmental Science',
    'Geography', 'Hindi', 'History', 'Home Science', 'Literature in English',
    'Mathematics', 'Physics', 'Political Science', 'Psychology', 'Sociology',
]
SUBJECTS_BY_BOARD = {'ICSE': ICSE_SUBJECTS, 'ISC': ISC_SUBJECTS}

# Subject-name token matcher: longer/more-specific patterns first. Shared
# across CISCE + Community + Doxxmarks + the Miscellaneous-prelims walk, so
# naming is consistent everywhere.
SUBJECT_TOKENS = [
    (re.compile(r'accountancy', re.I), 'Accountancy'),
    (re.compile(r'\baccounts\b', re.I), 'Accountancy'),
    (re.compile(r'business[\s_-]*studies', re.I), 'Business Studies'),
    (re.compile(r'biology|\bbio\b', re.I), 'Biology'),
    (re.compile(r'chemistry|\bchem\b', re.I), 'Chemistry'),
    (re.compile(r'\bcommerce\b', re.I), 'Commerce'),
    (re.compile(r'commercial[\s_-]*application|\bcomm(?:ercial)?[\s_.-]*app(?:s|lication)?\b', re.I), 'Commercial Applications'),
    (re.compile(r'commercial[\s_-]*stud|\bcomm(?:ercial)?[\s_.-]*stud(?:y|ies)?\b', re.I), 'Commercial Studies'),
    (re.compile(r'computer[\s_-]*application|\bcomp[\s_-]*app\b', re.I), 'Computer Applications'),
    (re.compile(r'computer[\s_-]*science', re.I), 'Computer Science'),
    (re.compile(r'\bcomputers?\b', re.I), 'COMPUTER_GENERIC'),
    (re.compile(r'economic[\s_-]*application', re.I), 'Economic Applications'),
    (re.compile(r'economics|\beco\b', re.I), 'Economics'),
    (re.compile(r'english[\s_-]*lang|\beng[\s_.-]*1\b|\beng(?:lish)?[\s_.-]*lang(?:uage)?\b|\belang\b|\blanguage\b', re.I), 'English Language'),
    (re.compile(r'literature[\s_-]*in[\s_-]*english|english[\s_-]*lit|\beng(?:lish)?[\s_.-]*lit(?:erature)?\b|\belit\b|\bliterature\b', re.I), 'Literature in English'),
    (re.compile(r'environmental[\s_-]*science|\bevs\b', re.I), 'Environmental Science'),
    (re.compile(r'geography|\bgeog?\b', re.I), 'Geography'),
    (re.compile(r'hindi', re.I), 'Hindi'),
    (re.compile(r'history[,\s_-]*(and|&)?[,\s_-]*civics[,\s_-]*(and|&)?[,\s_-]*geography', re.I), 'HCG_COMBINED'),
    (re.compile(r'history[\s_-]*(and|&)?[\s_-]*civics|civics[\s_-]*(and|&)?[\s_-]*history|hist[\s_-]*civics|\bhcg\b', re.I), 'History & Civics'),
    (re.compile(r'\bhistory\b|\bhist\b', re.I), 'HISTORY_GENERIC'),
    (re.compile(r'home[\s_-]*science', re.I), 'Home Science'),
    (re.compile(r'mathematics|\bmaths?\b', re.I), 'Mathematics'),
    (re.compile(r'physics|\bphy\b', re.I), 'Physics'),
    (re.compile(r'political[\s_-]*science|\bpol[\s_-]*sci\b', re.I), 'Political Science'),
    (re.compile(r'psychology', re.I), 'Psychology'),
    (re.compile(r'sociology', re.I), 'Sociology'),
    (re.compile(r'\bscience\b', re.I), 'SCIENCE_COMBINED'),
    (re.compile(r'\benglish\b', re.I), 'English Language'),
]

# Physical Education / third languages / other non-tracked subjects that
# should be explicitly excluded (never fall back to a loose filename match
# underneath them) rather than silently miscategorized.
EXCLUDE_TOKENS = re.compile(
    r'physical[\s_-]*education|\bPE\b|\bFrench\b|\bGerman\b|\bGujarati\b|\bMarathi\b|\bBengali\b|\bSanskrit\b',
    re.I,
)


def classify_subject(name: str, canonical: set):
    """Match `name` against SUBJECT_TOKENS, expanding the combined-science /
    combined-HCG sentinels into their real subject lists, and only
    returning subjects that are in `canonical` (the class's own subject
    set) — e.g. ISC has no 'History & Civics', ICSE has no 'History'."""
    if EXCLUDE_TOKENS.search(name):
        return None
    for pat, subj in SUBJECT_TOKENS:
        if pat.search(name):
            if subj == 'HCG_COMBINED':
                return [s for s in ('History & Civics', 'Geography') if s in canonical] or None
            if subj == 'SCIENCE_COMBINED':
                return [s for s in ('Physics', 'Chemistry', 'Biology') if s in canonical] or None
            if subj == 'HISTORY_GENERIC':
                return [s for s in ('History & Civics', 'History') if s in canonical] or None
            if subj == 'COMPUTER_GENERIC':
                return [s for s in ('Computer Applications', 'Computer Science') if s in canonical] or None
            return [subj] if subj in canonical else None
    return None


def clean_filename(name: str, mime_type: str | None) -> str:
    """Normalize a Drive filename: fix the stray-mid-string-extension bug
    seen in some uploads (e.g. "Biology.pdf - SQP - 2019" or "English
    Languagepdf") so every file consistently ends with its real extension,
    and collapse any accidental double spaces. Leaves filenames that
    already end with a recognizable extension untouched (aside from
    whitespace collapsing)."""
    ext_map = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png'}
    ext = ext_map.get(mime_type or '')
    if not ext:
        return re.sub(r'\s+', ' ', name).strip()
    if re.search(r'\.[a-z0-9]{2,5}$', name, re.I):
        return re.sub(r'\s+', ' ', name).strip()
    mid_ext = re.compile(r'\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg)(?=[\s\-]|$)', re.I)
    glued_ext = re.compile(r'(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|webp|svg)$', re.I)
    stripped = mid_ext.sub('', name)
    stripped = glued_ext.sub('', stripped)
    stripped = re.sub(r'(?<=[A-Za-z0-9])-(?=\s)', ' -', stripped)
    stripped = re.sub(r'\s+', ' ', stripped).strip().rstrip(' -')
    return f'{stripped}.{ext}'


def load(path):
    with open(path) as f:
        return json.load(f)


def meta_of(node):
    return {
        'mimeType': node.get('mimeType'),
        'createdTime': node.get('createdTime'),
        'modifiedTime': node.get('modifiedTime'),
        'size': node.get('size'),
    }


def make_item(node, group):
    return {'name': clean_filename(node['name'], node.get('mimeType')), 'id': node['id'], 'group': group, **meta_of(node)}


def walk_files(node, prefix=()):
    """Yield (raw_node, path_tuple) for every file leaf under `node`."""
    if node.get('type') == 'file':
        yield node, prefix
        return
    for c in node.get('children', []):
        if c.get('type') == 'file':
            yield c, prefix
        else:
            yield from walk_files(c, prefix + (c['name'],))


def build_folder_node(node, group_label):
    """Convert a raw Drive folder-tree node into the {type:'folder', name,
    children} shape consumed by the Lambda Prep UI's recursive folder
    navigator (used for Editor's Choice cards like Julius Caesar / Macbeth)."""
    children = []
    for c in node.get('children', []):
        if c.get('type') == 'folder':
            children.append(build_folder_node(c, group_label))
        elif c.get('id'):
            children.append(make_item(c, group_label))
    return {'type': 'folder', 'name': node['name'], 'children': children}


# ---------------------------------------------------------------------------
# CISCE Resources: type-folder (APF/CFQ/PYQP/SQP/Syllabus) -> year -> files,
# with the subject identified from the filename itself. Files are bucketed
# into every matching subject (combined Science / HCG papers fan out to
# all their component subjects, matching the legacy dataset's behavior).
# ---------------------------------------------------------------------------
TYPE_FOLDER_LABELS = [
    (re.compile(r'analysis of pupil performance', re.I), 'Analysis of Pupil Performance'),
    (re.compile(r'competency focused questions', re.I), 'CFQs'),
    (re.compile(r'previous year question papers', re.I), 'PYQs'),
    (re.compile(r'specimen question papers', re.I), 'Specimen QPs'),
    (re.compile(r'syllabus', re.I), 'Syllabus'),
]


def type_label_for(folder_name: str) -> str:
    for pat, label in TYPE_FOLDER_LABELS:
        if pat.search(folder_name):
            return label
    return folder_name


def insert_into_tree(tree: dict, path: tuple, item: dict):
    """Insert a file `item` into a nested dict tree keyed by `path` segments
    (e.g. ('PYQs', '2018')), creating intermediate folder levels as needed.
    Leaf files at a level are collected under the '__files__' key."""
    node = tree
    for segment in path:
        node = node.setdefault(segment, {})
    node.setdefault('__files__', []).append(item)


def tree_to_folder_nodes(tree: dict) -> list:
    """Convert a nested dict tree (as built by insert_into_tree) into the
    {type:'folder', name, children} shape the UI's folder navigator
    consumes. Subfolders come first (in insertion order), then this
    level's own loose files."""
    nodes = []
    for key, sub in tree.items():
        if key == '__files__':
            continue
        children = tree_to_folder_nodes(sub) + sub.get('__files__', [])
        nodes.append({'type': 'folder', 'name': key, 'children': children})
    return nodes


def build_cisce(class_slug: str, canonical: set):
    """Build each subject's official CISCE resources as a navigable folder
    tree (type folder, e.g. "PYQs" -> year folder -> files) instead of
    flat year-exploded groups, so the UI can offer the same folder-card
    drill-down navigation used for Community's curated folders (e.g.
    Literature in English's Julius Caesar) rather than listing every
    type/year combination as its own section."""
    path = os.path.join(CRAWL_DIR, class_slug, 'cisce.json')
    if not os.path.isfile(path):
        return None
    data = load(path)
    trees: dict[str, dict] = {s: {} for s in canonical}
    misc = []
    for node, file_path in walk_files(data):
        if not node.get('id'):
            continue
        if not file_path:
            # Loose top-level file (e.g. "Regulations - 2027.pdf") -- a
            # board-wide circular, not subject-specific paper content.
            misc.append(make_item(node, 'Other'))
            continue
        subs = classify_subject(node['name'], canonical)
        top_label = type_label_for(file_path[0])
        rel_path = (top_label,) + file_path[1:]
        if subs:
            for s in subs:
                insert_into_tree(trees[s], rel_path, make_item(node, rel_path[-1]))
        else:
            misc.append(make_item(node, top_label))
    subjects_out = []
    for s in canonical:
        folders = tree_to_folder_nodes(trees[s])
        if folders:
            subjects_out.append({
                'subject': s,
                'items': [],
                'editorFolders': folders,
                'editorFoldersGroup': 'CISCE Resources',
            })
    return {'subjects': subjects_out, 'misc': misc}


# ---------------------------------------------------------------------------
# Community Resources: top-level folders are already subject-named (one
# folder per subject, matching the class's own canonical set, plus
# "Featured" for loose top-level files and a "Miscellaneous" folder that
# itself nests many unrelated PYQ/prelim-paper collections with their own
# inconsistent internal structure (subject subfolders at varying depths,
# or school-named folders with subject-named files directly inside)).
# ---------------------------------------------------------------------------

# Folders promoted to recursive "Editor's Choice" folder-cards so the UI
# renders them as folder-navigable cards instead of flat files (matching
# the legacy dataset's Julius Caesar / Treasure Chest / Macbeth / Prism /
# Rhapsody treatment). Keyed by subject name.
EDITOR_FOLDER_NAMES_BY_SUBJECT = {
    'Literature in English': {'Julius Caesar', 'Treasure Chest', 'Macbeth', 'Prism', 'Rhapsody'},
}


def walk_misc_tree(node, active_subject, top_label, misc_out, buckets):
    """Depth-first walk of one "Miscellaneous" child collection (e.g. "STD.
    X", "2025 Prelim Papers"), assigning files to the nearest resolved
    subject-named ancestor folder. If no ancestor folder resolved to a
    subject yet, falls back to matching the file's own name (covers
    school-named folders with subject-named files directly inside, e.g.
    "AVM 2025/AVM Biology Prelim 2025.pdf"). Files under a folder that
    explicitly excluded (e.g. Physical Education) never fall back to
    filename matching."""
    for c in node.get('children', []):
        if c.get('type') == 'file':
            if not c.get('id'):
                continue
            subs = active_subject if active_subject not in (None, 'EXCLUDED') else None
            if subs is None and active_subject is None:
                subs = classify_subject(c['name'], set(buckets.keys()))
            if subs:
                for s in subs:
                    if s in buckets:
                        buckets[s].append(make_item(c, f'PYQ Prelims \u00b7 {top_label}'))
            else:
                misc_out.append(make_item(c, f'PYQ Prelims \u00b7 {top_label}'))
        else:
            resolved = classify_subject(c['name'], set(buckets.keys()))
            if EXCLUDE_TOKENS.search(c['name']):
                next_subject = 'EXCLUDED'
            elif resolved:
                next_subject = resolved
            else:
                next_subject = active_subject
            walk_misc_tree(c, next_subject, top_label, misc_out, buckets)


def build_community(class_slug: str, canonical: set):
    path = os.path.join(CRAWL_DIR, class_slug, 'community.json')
    if not os.path.isfile(path):
        return None
    data = load(path)
    buckets: dict[str, list] = {s: [] for s in canonical}
    extra_buckets: dict[str, list] = {}
    misc = []
    editor_folders_by_subject: dict[str, list] = {}

    for top in data.get('children', []):
        name = top.get('name', '').strip()
        if top.get('type') == 'file':
            if top.get('id'):
                extra_buckets.setdefault('Featured', []).append(make_item(top, 'Featured'))
            continue

        if name == 'Miscellaneous':
            # Each child here is its own independent collection (a prelims
            # pack, a school-year archive, ...) with its own internal
            # structure — walk each one separately so top_label tracks the
            # collection it actually came from.
            for collection in top.get('children', []):
                if collection.get('type') == 'file':
                    if collection.get('id'):
                        misc.append(make_item(collection, 'Miscellaneous'))
                    continue
                walk_misc_tree(collection, None, collection['name'].strip(), misc, {**buckets, **extra_buckets})
            continue

        subs_for_top = classify_subject(name, canonical)
        subject = subs_for_top[0] if subs_for_top and len(subs_for_top) == 1 else None
        if subject is None or subject not in canonical:
            # Non-canonical top-level folder -> its own subject bucket,
            # named after the folder itself, grouped by immediate parent.
            bucket = extra_buckets.setdefault(name, [])
            for node, file_path in walk_files(top):
                if not node.get('id'):
                    continue
                group = file_path[-1] if file_path else 'General'
                bucket.append(make_item(node, group))
            continue

        editor_names = EDITOR_FOLDER_NAMES_BY_SUBJECT.get(subject, set())
        top_for_walk = top
        if editor_names:
            editor_folders_by_subject.setdefault(subject, [])
            kept_children = []
            for c in top.get('children', []):
                if c.get('type') == 'folder' and c.get('name') in editor_names:
                    editor_folders_by_subject[subject].append(build_folder_node(c, 'General'))
                else:
                    kept_children.append(c)
            top_for_walk = dict(top, children=kept_children)

        for node, file_path in walk_files(top_for_walk):
            if not node.get('id'):
                continue
            group = file_path[-1] if file_path else 'General'
            buckets[subject].append(make_item(node, group))

    subjects_out = [{'subject': s, 'items': items} for s, items in buckets.items() if items]
    subjects_out.extend({'subject': s, 'items': items} for s, items in extra_buckets.items() if items)
    for s in subjects_out:
        folders = editor_folders_by_subject.get(s['subject'])
        if folders:
            s['editorFolders'] = folders

    return {'subjects': subjects_out, 'misc': misc}


# ---------------------------------------------------------------------------
# Doxxmarks InstaRevision chapter notes -> curriculum.json revisionNotes.
# Tree shape: Doxxmarks / <class folder, e.g. "ICSE - X"> / <subject> /
# <chapter name> - InstaRevision.pdf
# ---------------------------------------------------------------------------
DOXXMARKS_CLASS_FOLDER_TO_SLUG = {
    'icse - ix': 'icse-9', 'icse - x': 'icse-10', 'isc - xi': 'isc-11', 'isc - xii': 'isc-12',
}


def _normalize_chapter_key(name: str) -> str:
    """Loosely normalize a chapter name for fuzzy matching against
    Doxxmarks InstaRevision filenames, which don't always agree with the
    curriculum's chapter name on singular/plural or punctuation (e.g.
    "Refraction of Light at Plane Surface" vs "...Plane Surfaces"). Lowercases,
    strips all punctuation, collapses whitespace, and strips a single
    trailing 's' from each word (crude singularization) so minor
    singular/plural drift still matches."""
    words = re.findall(r'[a-z0-9]+', name.lower())
    singularized = [w[:-1] if len(w) > 3 and w.endswith('s') else w for w in words]
    return ' '.join(singularized)


def update_curriculum_revision_notes():
    doxx_path = os.path.join(CRAWL_DIR, 'doxxmarks.json')
    if not os.path.isfile(doxx_path):
        print('skip: no doxxmarks.json crawl output found')
        return
    doxx = load(doxx_path)
    # (class_slug, subject_name, normalized_chapter_key) -> [{name, link}]
    notes_by_key: dict[tuple, list] = {}
    for class_folder in doxx.get('children', []):
        if class_folder.get('type') != 'folder':
            continue
        class_slug = DOXXMARKS_CLASS_FOLDER_TO_SLUG.get(class_folder['name'].strip().lower())
        if not class_slug:
            continue
        for subject_folder in class_folder.get('children', []):
            if subject_folder.get('type') != 'folder':
                continue
            subject_name = subject_folder['name'].strip()
            for node, _ in walk_files(subject_folder):
                if not node.get('id'):
                    continue
                chapter_name = re.sub(r'\.(pdf|docx?|pptx?)$', '', node['name'], flags=re.I)
                chapter_name = re.sub(r'\s*-\s*InstaRevision\s*$', '', chapter_name, flags=re.I).strip()
                link = f"https://drive.google.com/file/d/{node['id']}/view"
                key = (class_slug, subject_name, _normalize_chapter_key(chapter_name))
                notes_by_key.setdefault(key, []).append({'name': 'InstaRevision Notes', 'link': link})

    if not notes_by_key:
        print('skip: no InstaRevision chapter notes found in doxxmarks.json')
        return

    with open(CURRICULUM_PATH) as f:
        curriculum = json.load(f)

    updated = 0
    for class_slug, (board, roman) in BOARD_ROMAN_BY_SLUG.items():
        board_data = curriculum.get('boards', {}).get(board, {})
        class_data = board_data.get('classes', {}).get(roman, {})
        for subject in class_data.get('subjects', []):
            for chapter in subject.get('chapters', []):
                key = (class_slug, subject.get('name', '').strip(), _normalize_chapter_key(chapter.get('name', '').strip()))
                notes = notes_by_key.get(key)
                if notes:
                    chapter['revisionNotes'] = notes
                    updated += 1

    with open(CURRICULUM_PATH, 'w') as f:
        json.dump(curriculum, f, ensure_ascii=False)
    print(f'Updated revisionNotes for {updated} chapter(s) in {CURRICULUM_PATH}')


def main():
    for class_slug in CLASS_SLUGS:
        board, _roman = BOARD_ROMAN_BY_SLUG[class_slug]
        canonical = set(SUBJECTS_BY_BOARD[board])

        cisce = build_cisce(class_slug, canonical)
        if cisce is not None:
            out_path = os.path.join(DATA_DIR, f'resources-cisce-{class_slug}.json')
            with open(out_path, 'w') as f:
                json.dump(cisce, f, ensure_ascii=False)
            print(f'{class_slug} CISCE subjects:', [(s['subject'], len(s['items'])) for s in cisce['subjects']])
            print(f'{class_slug} CISCE misc:', len(cisce['misc']))
        else:
            print(f'skip {class_slug} CISCE: no crawl output found')

        community = build_community(class_slug, canonical)
        if community is not None:
            out_path = os.path.join(DATA_DIR, f'resources-community-{class_slug}.json')
            with open(out_path, 'w') as f:
                json.dump(community, f, ensure_ascii=False)
            print(f'{class_slug} Community subjects:', [(s['subject'], len(s['items'])) for s in community['subjects']])
            print(f'{class_slug} Community misc:', len(community['misc']))
        else:
            print(f'skip {class_slug} Community: no crawl output found')

    update_curriculum_revision_notes()


if __name__ == '__main__':
    main()
