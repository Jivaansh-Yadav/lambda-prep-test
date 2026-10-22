#!/usr/bin/env python3
"""Shard any monolithic resources-<source>-<class>.json dataset (shape:
{ subjects: [{subject, items, editorFolders?}], misc }) that's grown past
SPLIT_THRESHOLD_BYTES into a manifest + one JSON file per subject + a
misc.json, under src/data/resources-<source>-<class>/.

This lets the app lazy-load one subject's files at a time instead of
downloading the whole multi-MB dataset up front (see
src/lib/resources-data.ts's split-dataset loaders).

Scans every src/data/resources-{cisce,community}-{icse-9,icse-10,isc-11,
isc-12}.json file that exists; datasets under the size threshold are left
alone (loaded monolithically by resources-data.ts).

Usage:
  python3 scripts/split-resources-dataset.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'src', 'data')

SOURCES = ['cisce', 'community']
CLASS_SLUGS = ['icse-9', 'icse-10', 'isc-11', 'isc-12']

# Datasets at or above this size get sharded into per-subject files so the
# app never has to download the whole thing just to show one subject.
SPLIT_THRESHOLD_BYTES = 200 * 1024


def slugify(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def split_one(src_path, out_dir):
    with open(src_path) as f:
        data = json.load(f)

    os.makedirs(out_dir, exist_ok=True)

    manifest = {'subjects': [], 'miscCount': len(data.get('misc', []))}
    valid_slugs = set()
    for s in data.get('subjects', []):
        slug = slugify(s['subject'])
        valid_slugs.add(slug)
        manifest['subjects'].append({'subject': s['subject'], 'slug': slug, 'count': len(s['items'])})
        payload = {'items': s['items']}
        if s.get('editorFolders'):
            payload['editorFolders'] = s['editorFolders']
        with open(os.path.join(out_dir, f'{slug}.json'), 'w') as f:
            json.dump(payload, f, ensure_ascii=False)

    with open(os.path.join(out_dir, 'misc.json'), 'w') as f:
        json.dump(data.get('misc', []), f, ensure_ascii=False)

    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, ensure_ascii=False)

    # Remove stale per-subject shards left over from a previous run (e.g. a
    # subject that got renamed, like English Literature -> Literature in
    # English, would otherwise leave its old slug's JSON file orphaned).
    keep_files = valid_slugs | {'misc', 'manifest'}
    for fname in os.listdir(out_dir):
        if not fname.endswith('.json'):
            continue
        if fname[:-5] not in keep_files:
            os.remove(os.path.join(out_dir, fname))
            print(f'  removed stale shard {fname}')

    # The monolithic source file is only an intermediate build artifact once
    # split — the app loads from the sharded directory, not this file.
    os.remove(src_path)

    total = sum(s['count'] for s in manifest['subjects']) + manifest['miscCount']
    print(f'  split {len(manifest["subjects"])} subjects + misc ({manifest["miscCount"]}) = {total} files -> {out_dir}')


def remove_stale_split_dir(out_dir):
    """If a dataset that used to be split has shrunk back under the
    threshold, remove the stale split directory so resources-data.ts's
    monolithic loader (and the regenerated .json file) is the only source
    of truth again."""
    if os.path.isdir(out_dir):
        import shutil
        shutil.rmtree(out_dir)
        print(f'  removed stale split dir {out_dir} (dataset now under threshold)')


def main():
    any_found = False
    for source in SOURCES:
        for class_slug in CLASS_SLUGS:
            src_path = os.path.join(DATA_DIR, f'resources-{source}-{class_slug}.json')
            out_dir = os.path.join(DATA_DIR, f'resources-{source}-{class_slug}')
            if not os.path.isfile(src_path):
                continue
            any_found = True
            size = os.path.getsize(src_path)
            label = f'{source}/{class_slug}'
            if size >= SPLIT_THRESHOLD_BYTES:
                print(f'{label}: {size} bytes >= threshold, splitting...')
                split_one(src_path, out_dir)
            else:
                print(f'{label}: {size} bytes, left monolithic')
                remove_stale_split_dir(out_dir)

    if not any_found:
        print('skip: no resources-*.json datasets found')


if __name__ == '__main__':
    main()
