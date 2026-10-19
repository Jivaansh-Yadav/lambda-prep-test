#!/usr/bin/env python3
"""Shard a monolithic resources-community-icse-10.json (or any dataset using
the same { subjects: [{subject, items, editorFolders?}], misc } shape) into
a manifest + one JSON file per subject + a misc.json, under
src/data/resources-community-icse-10/.

This lets the app lazy-load one subject's files at a time instead of
downloading the whole multi-MB dataset up front (see
src/lib/resources-data.ts's split-dataset loaders).

Usage:
  python3 scripts/split-resources-dataset.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'src', 'data')

SRC_PATH = os.path.join(DATA_DIR, 'resources-community-icse-10.json')
OUT_DIR = os.path.join(DATA_DIR, 'resources-community-icse-10')


def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def main():
    if not os.path.isfile(SRC_PATH):
        print(f'skip: {SRC_PATH} not found (nothing to split)')
        return

    with open(SRC_PATH) as f:
        data = json.load(f)

    os.makedirs(OUT_DIR, exist_ok=True)

    manifest = {'subjects': [], 'miscCount': len(data.get('misc', []))}
    for s in data.get('subjects', []):
        slug = slugify(s['subject'])
        manifest['subjects'].append({'subject': s['subject'], 'slug': slug, 'count': len(s['items'])})
        payload = {'items': s['items']}
        if s.get('editorFolders'):
            payload['editorFolders'] = s['editorFolders']
        with open(os.path.join(OUT_DIR, f'{slug}.json'), 'w') as f:
            json.dump(payload, f, ensure_ascii=False)

    with open(os.path.join(OUT_DIR, 'misc.json'), 'w') as f:
        json.dump(data.get('misc', []), f, ensure_ascii=False)

    with open(os.path.join(OUT_DIR, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, ensure_ascii=False)

    # The monolithic source file is only an intermediate build artifact once
    # split — the app loads from the sharded directory, not this file.
    os.remove(SRC_PATH)

    total = sum(s['count'] for s in manifest['subjects']) + manifest['miscCount']
    print(f'Split {len(manifest["subjects"])} subjects + misc ({manifest["miscCount"]}) = {total} files')
    print(f'Wrote shards to {OUT_DIR}')
    print(f'Removed intermediate {SRC_PATH}')


if __name__ == '__main__':
    main()
