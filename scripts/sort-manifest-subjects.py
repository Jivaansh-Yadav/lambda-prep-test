#!/usr/bin/env python3
"""Sort the subject order inside a resources manifest.json: "Featured"
always first, then every other subject alphabetically. "Miscellaneous" is
not part of manifest.json (the UI appends it last via miscCount), so it
needs no handling here.

Run after split-resources-dataset.py (or any manifest-producing step) to
normalize subject card order for display:

  python3 scripts/sort-manifest-subjects.py

Operates on every manifest.json found under src/data/resources-*/ so it
covers all datasets (community ICSE-10, ISC-11, etc.), not just one.
"""
import json
import os
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'src', 'data')

FEATURED = 'Featured'


def sort_key(entry):
    subject = entry['subject']
    if subject == FEATURED:
        return (0, '')
    return (1, subject.lower())


def sort_manifest(path):
    with open(path) as f:
        manifest = json.load(f)
    subjects = manifest.get('subjects')
    if not isinstance(subjects, list):
        return False
    sorted_subjects = sorted(subjects, key=sort_key)
    if sorted_subjects == subjects:
        return False
    manifest['subjects'] = sorted_subjects
    with open(path, 'w') as f:
        json.dump(manifest, f, ensure_ascii=False)
    return True


def main():
    pattern = os.path.join(DATA_DIR, 'resources-*', 'manifest.json')
    manifests = sorted(glob.glob(pattern))
    if not manifests:
        print(f'No manifest.json files found under {DATA_DIR}/resources-*/')
        return
    for path in manifests:
        changed = sort_manifest(path)
        rel = os.path.relpath(path, ROOT)
        print(f'{"sorted" if changed else "already sorted"}: {rel}')


if __name__ == '__main__':
    main()
