#!/usr/bin/env python3
"""Count resources (files) across all Lambda Prep resource datasets and
write a summary JSON with per-source/per-class/per-subject counts.

Handles both dataset shapes used in src/data/:
  - Monolithic: { subjects: [{ subject, items: [...] }], misc: [...] }
    (e.g. resources-cisce-icse-10.json, resources-community-isc-11.json)
  - Split: a directory with manifest.json ({ subjects: [{subject,slug,count}],
    miscCount }) + one <slug>.json per subject + misc.json
    (e.g. resources-community-icse-10/)

Usage:
  python3 scripts/count-resources.py
Writes: src/data/resource-counts.json
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'src', 'data')
OUT_PATH = os.path.join(DATA_DIR, 'resource-counts.json')

# (source, classSlug) -> path (monolithic .json file) or dir (split dataset)
SOURCES = ['cisce', 'community']
CLASS_SLUGS = ['icse-9', 'icse-10', 'isc-11', 'isc-12']


def dataset_path(source, class_slug):
    split_dir = os.path.join(DATA_DIR, f'resources-{source}-{class_slug}')
    if os.path.isdir(split_dir):
        return split_dir
    return os.path.join(DATA_DIR, f'resources-{source}-{class_slug}.json')


def folder_file_count(nodes):
    """Files nested anywhere inside an editorFolders tree."""
    n = 0
    for node in nodes:
        if node.get('type') == 'folder':
            n += folder_file_count(node.get('children', []))
        else:
            n += 1
    return n


def count_monolithic(path):
    with open(path) as f:
        data = json.load(f)
    # A folder-nav group stores its files in `editorFolders` instead of `items`
    # (the UI renders the tree, not the loose list), so add both.
    subjects = {
        s['subject']: len(s['items']) + folder_file_count(s.get('editorFolders', []))
        for s in data.get('subjects', [])
    }
    misc = len(data.get('misc', []))
    total = sum(subjects.values()) + misc
    return {'subjects': subjects, 'misc': misc, 'total': total}


def count_split(dir_path):
    """Count what the shards actually hold instead of trusting the manifest's
    own `count` fields.

    The manifest is display metadata (subject -> shard, card order); its counts
    are written by split-resources-dataset.py and were the reason a sharded
    class under-reported its total while the same data loaded monolithically
    reported the truth. Reading the shards makes the manifest unable to drift
    from the files it describes without the mismatch showing up here."""
    manifest_path = os.path.join(dir_path, 'manifest.json')
    with open(manifest_path) as f:
        manifest = json.load(f)
    subjects = {}
    for entry in manifest.get('subjects', []):
        shard_path = os.path.join(dir_path, f"{entry['slug']}.json")
        if not os.path.isfile(shard_path):
            subjects[entry['subject']] = 0
            continue
        with open(shard_path) as f:
            payload = json.load(f)
        subjects[entry['subject']] = len(payload.get('items') or []) + folder_file_count(
            payload.get('editorFolders') or []
        )
    misc_path = os.path.join(dir_path, 'misc.json')
    misc = 0
    if os.path.isfile(misc_path):
        with open(misc_path) as f:
            misc = len(json.load(f) or [])
    total = sum(subjects.values()) + misc
    return {'subjects': subjects, 'misc': misc, 'total': total}


def main():
    result = {}
    grand_total = 0
    for source in SOURCES:
        for class_slug in CLASS_SLUGS:
            path = dataset_path(source, class_slug)
            if os.path.isdir(path):
                counts = count_split(path)
            elif os.path.isfile(path):
                counts = count_monolithic(path)
            else:
                print(f'skip {source}/{class_slug}: {path} not found')
                continue
            result.setdefault(source, {})[class_slug] = counts
            grand_total += counts['total']
            print(f'{source}/{class_slug}: {counts["total"]} files '
                  f'({len(counts["subjects"])} subjects, {counts["misc"]} misc)')

    output = {'generatedAt': None, 'grandTotal': grand_total, 'bySource': result}
    # Stamp a UTC timestamp without relying on an extra import at module load.
    import datetime
    output['generatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with open(OUT_PATH, 'w') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\nGrand total: {grand_total} files across all datasets')
    print(f'Wrote {OUT_PATH}')


if __name__ == '__main__':
    main()
