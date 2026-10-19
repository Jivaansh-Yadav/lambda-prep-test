#!/usr/bin/env python3
"""Merge ISC Class XI community resource JSON trees (per-subject Google Drive
folder dumps) into a single resources-community-isc-11.json matching the
shape used by resources-community-icse-10.json / resources-cisce-icse-10.json:

  { "subjects": [ { "subject": str, "items": [ { "name", "id", "group" } ],
                     "editorFolders"?: [ {type:'folder', name, children} ] } ],
    "misc": [ { "name", "id", "group" } ] }

Each input file is a Google-Drive-folder-tree dump rooted at the subject
folder itself (name == subject folder name, e.g. "Chemistry", "Maths").
Group label = breadcrumb of subfolders below the subject root, joined by
" · ", or "General" for files directly inside the subject root.

Macbeth / Prism / Rhapsody (English Literature) are additionally emitted as
recursive `editorFolders` folder-nodes so the UI can render them as
folder-navigable "Editor's Choice" cards instead of flat files; they are
excluded from the flat `items` list to avoid duplication.
"""
import json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Primary source: the Drive crawl's own ISC-11 output (scripts/drive-crawl/
# generate-drive-json.js writes one {slug}.json per subject folder here).
# ISC11_SRC_DIR can still override this (e.g. for local one-off uploads to
# /tmp/clacky-uploads) when the crawl hasn't been run.
DRIVE_CRAWL_OUT = os.path.join(ROOT, 'scripts', 'drive-crawl', 'output', 'isc-11')
SRC_DIR = os.environ.get('ISC11_SRC_DIR', DRIVE_CRAWL_OUT)
OUT_PATH = os.path.join(ROOT, 'src', 'data', 'resources-community-isc-11.json')

# filename slug -> canonical subject name (matches src/lib/lambda.ts `subjects`).
# Covers both the Drive crawl's slugified subject-folder names (chemistry.json,
# english.json, maths.json, physics.json) and the legacy manually-uploaded
# filenames from before the crawl covered ISC-11.
SOURCES_BY_SLUG = {
    'chemistry': 'Chemistry',
    'english': 'English',
    'maths': 'Mathematics',
    'mathematics': 'Mathematics',
    'physics': 'Physics',
}
LEGACY_UPLOAD_SOURCES = {
    '20bc943212a30034_chemistry.json': 'Chemistry',
    '9a8dfba8ba64f4c2_english.json': 'English',
    '0ac513c2cc0b0021_maths.json': 'Mathematics',
    'a3576d60003ef70d_physics.json': 'Physics',
}


def discover_sources(src_dir):
    """Build {filename: subject_name} for whatever is actually present in
    src_dir — the crawl's slugified names if present, else fall back to the
    legacy hardcoded upload filenames (for local sandbox use)."""
    sources = {}
    if os.path.isdir(src_dir):
        for path in sorted(glob.glob(os.path.join(src_dir, '*.json'))):
            slug = os.path.splitext(os.path.basename(path))[0]
            subject = SOURCES_BY_SLUG.get(slug)
            if subject:
                sources[os.path.basename(path)] = subject
    if sources:
        return sources
    # Nothing matched by slug — fall back to the legacy upload filenames if
    # they exist in src_dir (keeps old sandbox workflow working unchanged).
    legacy = {f: s for f, s in LEGACY_UPLOAD_SOURCES.items() if os.path.isfile(os.path.join(src_dir, f))}
    return legacy


SOURCES = discover_sources(SRC_DIR)

LIT_EDITOR_FOLDERS = {'Macbeth', 'Prism', 'Rhapsody'}


def walk(node, breadcrumb, items):
    for child in node.get('children', []):
        if child['type'] == 'file':
            group = ' · '.join(breadcrumb) if breadcrumb else 'General'
            items.append({'name': child['name'], 'id': child['id'], 'group': group})
        elif child['type'] == 'folder':
            walk(child, breadcrumb + [child['name']], items)


def build_folder_node(node, group_label):
    children = []
    for c in node.get('children', []):
        if c.get('type') == 'folder':
            children.append(build_folder_node(c, group_label))
        elif c.get('id'):
            children.append({'name': c['name'], 'id': c['id'], 'group': group_label})
    return {'type': 'folder', 'name': node['name'], 'children': children}


def main():
    if not SOURCES:
        print(f'No ISC-11 source files found in {SRC_DIR} — nothing to do.')
        return
    subjects = []
    for filename, subject_name in SOURCES.items():
        with open(f'{SRC_DIR}/{filename}') as f:
            tree = json.load(f)

        if subject_name == 'English':
            # Find the "Literature" subfolder so we can pull out
            # Macbeth/Prism/Rhapsody as recursive editorFolders before the
            # flat walk, keeping everything else unchanged.
            literature_node = next(
                (c for c in tree.get('children', []) if c.get('type') == 'folder' and c.get('name') == 'Literature'),
                None,
            )
            editor_folders = []
            literature_node_for_walk = literature_node
            if literature_node:
                editor_folders = [
                    build_folder_node(c, 'General')
                    for c in literature_node.get('children', [])
                    if c.get('type') == 'folder' and c.get('name') in LIT_EDITOR_FOLDERS
                ]
                literature_node_for_walk = dict(literature_node, children=[
                    c for c in literature_node.get('children', [])
                    if not (c.get('type') == 'folder' and c.get('name') in LIT_EDITOR_FOLDERS)
                ])
                tree = dict(tree, children=[
                    literature_node_for_walk if c is literature_node else c
                    for c in tree.get('children', [])
                ])

            items = []
            walk(tree, [], items)

            # Split into separate "English Language" / "English Literature" subjects
            # so each links to its own folder (Language vs Literature/*) in the UI.
            language_items = [i for i in items if i['group'] == 'Language' or i['group'] == 'General']
            literature_items = [i for i in items if i['group'].startswith('Literature')]
            # Strip the leading "Literature" segment from literature group labels,
            # e.g. "Literature · Macbeth" -> "Macbeth", "Literature" -> "General".
            for i in literature_items:
                rest = i['group'][len('Literature'):].lstrip(' ·')
                i['group'] = rest if rest else 'General'
            subjects.append({'subject': 'English Language', 'items': language_items})
            lit_subject = {'subject': 'English Literature', 'items': literature_items}
            if editor_folders:
                lit_subject['editorFolders'] = editor_folders
            subjects.append(lit_subject)
            print(f'English Language: {len(language_items)} items')
            print(f'English Literature: {len(literature_items)} items, {len(editor_folders)} editor folders')
            continue

        items = []
        walk(tree, [], items)
        subjects.append({'subject': subject_name, 'items': items})
        print(f'{subject_name}: {len(items)} items')

    out = {'subjects': subjects, 'misc': []}
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, ensure_ascii=False)
    print(f'Wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
