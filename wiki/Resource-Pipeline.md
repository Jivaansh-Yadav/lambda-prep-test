# Resource-Pipeline

Everything under `src/data/resources-*`, `src/data/*/` shards, `src/data/*/manifest.json`, `resource-counts.json` and the `revisionNotes` inside `doxxmarks_resources.json` is **generated**. The pipeline is the only writer; editing a dataset by hand survives exactly one scheduled run.

## Where the content comes from

One Google Drive root, folder id `1Dref01UoCLaP6DrQHRxqY1Nrj-f5illc` (also the target of the `/drive` short link):

```
Lambda/            (the Drive folder keeps its original name)
├── ICSE - IX/          ├── CISCE Resources/      (APF, CFQ, PYQP, SQP, Syllabus…)
│                       └── Community Resources/  (subject folders)
├── ICSE - X/           same shape
├── ISC - XI/           same shape
├── ISC - XII/          same shape
└── Doxxmarks/<class>/<subject>/<chapter> - InstaRevision.pdf
```

Folder names are matched case-insensitively: `icse - ix` → `icse-9` via `CLASS_FOLDER_TO_SLUG`. An unrecognised top-level folder is logged and skipped rather than failing the crawl — that is how a new folder can be added to Drive without breaking the weekly run.

## The five stages

| # | Stage | Script | Output |
| --- | --- | --- | --- |
| 1 | Crawl | `scripts/drive-crawl/generate-drive-json.js` | `scripts/drive-crawl/output/<class>/{cisce,community}.json`, `output/doxxmarks.json` |
| 2 | Transform | `scripts/transform-resources.py` | `src/data/resources-{cisce,community}-<class>.json` |
| 3 | Split | `scripts/split-resources-dataset.py` | `src/data/resources-<source>-<class>/{manifest.json,<subject>.json}` |
| 4 | Sort | `scripts/sort-manifest-subjects.py` | same manifests, subjects reordered |
| 5 | Count | `scripts/count-resources.py` | `src/data/resource-counts.json` |

Then a sixth, independent pair of steps re-signs the Doxxmarks PDFs — see [Doxxmarks-and-Signed-Links](Doxxmarks-and-Signed-Links).

### 1. Crawl

- Auth: a Google **service account**, written to `scripts/drive-crawl/service-account.json` (gitignored) by `fetch-credentials.mjs`, which reads the key from Neon's `drive_integration.service_account_json` over the database's HTTP `/sql` endpoint — the same row the running app uses, so a rotated key cannot leave the crawl on a stale copy. `SERVICE_ACCOUNT` (raw key JSON) is only a fallback for a runner without database access.
- Walk: breadth-first per folder, children sorted folders-first then alphabetically so file order is stable between runs. A stable order matters: an unstable crawl produces a diff every week even when nothing changed.
- Resilience: the Doxxmarks walk uses its own exponential-backoff retries because it descends one very large tree, and a single `429`/`503` from the Drive API used to kill the whole run.
- Output shape: the raw Drive tree (`id`, `name`, `mimeType`, `type`, `children`) — no transformation, no renaming. This is a build artifact; `scripts/drive-crawl/output/` is gitignored.

### 2. Transform

`transform-resources.py` reads the crawl output and writes the datasets the UI actually loads:

- Classifies each file into a group (APF, CFQ, PYQP, SQP, Syllabus, notes, papers…) from its parent folder path.
- Normalises display names — the redundant, ugly or duplicated parts of filenames are stripped — and keeps the Drive `id` so links resolve.
- Emits `resources-{cisce,community}-<class>.json` only for classes with crawl output present; a missing class does not wipe the others.
- **Refuses to overwrite a populated dataset with an empty one.** An empty build means the Drive source folder was emptied, moved, or is no longer visible to the service account — not that the whole library was deleted on purpose. The last good file is kept and the run prints `REFUSED …` instead of committing a wipe. A drop of more than half still writes, but prints `WARNING` so the commit is reviewed rather than trusted.
- **Sorts files by name inside each group** — natural, case-insensitive, so `Paper 2` comes before `Paper 10` and `2019` before `2023` — and orders folder cards by type-folder reading order (PYQs → Specimen QPs → CFQs → Analysis of Pupil Performance → Syllabus), then year **newest first**, so PYQs opens on 2026 rather than 2017. Drive hands back a folder's children in its own order and drops new uploads wherever it likes, so without this an unchanged re-crawl reshuffles lists: diff noise in the commit, and file order that moves under the student each week. Group *sections* keep their existing sequence (the UI renders sections in data order); only the files inside a section are sorted.
- Writes subjects in canonical order (the subject list in `SUBJECTS_BY_BOARD`), not set order, so regenerating an unchanged class produces a byte-identical file.
- Rewrites the community attribution block, including the note that files are hosted by their original contributors and that Lambda Prep renames and organises the index only.

### Why a file shows up under "Miscellaneous"

Official CISCE folders have no subject in the path (`Previous Year Question Papers (PYQP) → 2023 → <file>`), so the subject is read from the **filename**. `classify_subject()` matches the name against `SUBJECT_TOKENS`; a file whose name contains no subject token — `Letter Writing - SQP - 2019.pdf`, or a typo like `Commerical Applications - …` — matches nothing and is parked in the dataset's `misc` list, which the UI labels **Miscellaneous**.

Fix it in Drive, then re-run the pipeline: rename the file to lead with the subject (`English Language - Letter Writing - SQP - 2019.pdf`). Editing the generated JSON by hand only holds until the next run, and the next run will move the file back. Keep naming rules in mind when a new bucket still looks wrong after a rename: a token like `English` alone is ambiguous (Language vs Literature), so spell the subject out.

### 3. Split — sharding is a data decision

A catalogue that loads as one JSON blob is fine at 500 entries and painful at 5,000: the payload blocks first render and one typo invalidates every cached copy. `split-resources-dataset.py` shards a dataset that both reaches **200 KB** and is listed in `SPLIT_ALLOWLIST`, into:

```
src/data/resources-community-icse-10/
├── manifest.json        # subject → shard file, counts, Featured order
├── physics.json
├── chemistry.json
└── …
```

`manifest.json` keeps the subject → shard map, so at runtime the route fetches only the shard the student opened. Because the split is upstream of the UI, nothing at render time guesses where a subject lives: `resources-data.ts` checks for the manifest and follows it.

Size alone is **not** the trigger: `SPLIT_ALLOWLIST` names the datasets that may be sharded, because `resources-data.ts` has to register per-subject dynamic imports for each one (that is where the manifest's subject → shard map is actually consumed). Sharding a dataset with no registered loader deletes the monolithic `.json` the app still imports and leaves its subject pages empty, so a dataset crossing 200 KB without being on the allowlist is reported and left monolithic. To shard a new one, add it to both places.

A shard's `count` includes the files inside its `editorFolders` tree, not just its loose `items`: CISCE subjects and Editor's Choice collections render as folder trees and can hold hundreds of files with zero `items`. Counting only `items` once made a sharded class report 5,861 files where the same data loaded monolithically reported 6,031.

The 200 KB threshold is a **proxy for "too big for one blocking import"**, not a hard limit — raise it only after measuring the actual first-load payload on a throttled phone.

### 4. Sort

Subject cards must read **Featured first, then A–Z** — the same order on the class page, the resources browser and the sitemap. `sort-manifest-subjects.py` is the single place that decides, so three components cannot drift. It rewrites every `manifest.json` in place, which is why it runs after the split. Ordering of the files and folder cards *inside* a subject is stage 2's job, not this script's.

### 5. Count

`count-resources.py` walks every dataset and writes `resource-counts.json`: per class, per source, totals. It counts the files inside `editorFolders` too, not just loose `items` — a CISCE subject or an Editor's Choice collection renders as a folder tree and can have zero `items` while holding hundreds of files.

That distinction matters because the class page does **not** read `resource-counts.json`: it sums the per-subject `count` values in each `manifest.json`, which is why a shard's count is computed the same way. Counting only `items` while building the manifest made sharded subjects report fewer files than the identical data loaded monolithically (ICSE X Community: 5,861 vs 6,031). `count-resources.py` therefore counts the shard files themselves rather than trusting those manifest numbers, so a stale manifest shows up as a disagreement instead of silently misreporting the library.

## Running it

Local, all five stages in one command:

```bash
node scripts/generate-all-resources.js               # full run (needs Drive credentials)
node scripts/generate-all-resources.js --skip-crawl   # reuse the last crawl output
```

The orchestrator `spawn`s each stage, streams its output, and **aborts on the first non-zero exit**. Fail-fast is the point: a broken transform after a good crawl must not leave half the classes refreshed. `--skip-crawl` exists so iterating on the transforms is cheap without pretending the data is fresh.

In CI the orchestrator is **not** used. `.github/workflows/update-resources.yml` runs the same scripts as individual steps so each one is visible in the run tracker (see [Admin-and-Analytics](Admin-and-Analytics)).

## The CI workflow

`.github/workflows/update-resources.yml`

- **Schedule:** `0 3 * * 1` — Mondays 03:00 UTC. Also `workflow_dispatch`, which is what the admin panel's “Update resource datasets” button calls.
- **Permissions:** `contents: write` (the job commits), nothing else.
- **Concurrency:** group `update-resource-datasets`, `cancel-in-progress: false` — two crawls racing the same generated files would conflict and the second push would be rejected after a full run.
- **Timeout:** `30` minutes. A hung Drive crawl used to be able to burn GitHub's 6-hour default.
- **Step naming:** every step begins with a `[Category]` tag (`[Setup]`, `[Crawl]`, `[Datasets]`, `[InstaRevision]`, `[Commit]`). The admin tracker groups by that tag — **keep the tag when adding or renaming a step**, or it lands in “Other”.
- **Credentials:** both credentials the run needs live in Neon, so the workflow holds exactly one secret — `DATABASE_URL`. `scripts/drive-crawl/neon-config.mjs` is the only reader: the `[Setup]` step's `fetch-credentials.mjs` pulls `drive_integration.service_account_json`, validates it has a `client_email` and `private_key`, and writes `scripts/drive-crawl/service-account.json` with mode `600`; the `[InstaRevision]` step's `generate-insta-revision-links.mjs` pulls the upload credential from `insta_revision_integration` and builds the `Authorization` header itself. Neither script has a fallback literal — a missing row is a loud failure, not a stale credential. The Drive validation exists because googleapis falls back to anonymous Application Default Credentials when that file is empty and reports it as a Drive permission error. `SERVICE_ACCOUNT` and `INSTA_REVISION_AUTH` remain as env overrides for a local run. See [Database](Database) for the rows.
- **Commit step:** deletes the service-account file first, writes a `git diff --stat -- src/data` summary into the job summary, then commits only if something changed:

```bash
git add src/data
if git diff --cached --quiet; then echo "No dataset changes — nothing to commit."
else git commit -m "chore: regenerate resource datasets [skip ci]" && git push; fi
```

`[skip ci]` stops the dataset commit from triggering a second workflow run.

## Failure modes and what they mean

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Method doesn't allow unregistered callers` / `Permission denied on the service`, retried 6×, crawl exits 1 | No usable credentials: `service-account.json` was empty, so googleapis fell back to anonymous Application Default Credentials. The message is about *identity*, not Drive sharing | Fixed at the source — `fetch-credentials.mjs` fails in seconds with `No credentials…` or `drive_integration.service_account_json is empty` instead of getting this far |
| Crawl step 403 on every folder | Service account lost access to the Drive root | Share the root with the service-account email again |
| `❌ No credentials. Set DATABASE_URL…` in `[Setup]` | Neither the `DATABASE_URL` secret nor `SERVICE_ACCOUNT` reached the runner | Add `DATABASE_URL` (preferred) under Settings → Secrets and variables → Actions |
| `❌ drive_integration has no row` | The key was never seeded in Neon | Seed the row from `/admin` → Drive integration, or SQL |
| Transform succeeds, one class missing | No crawl output for that class (folder renamed or skipped) | Check the “Unrecognized top-level folder” line in the crawl log |
| Datasets shrink unexpectedly | Drive folder reorganised | Inspect the `[Commit] Summarize dataset diff` block in the run summary before pushing; `git revert` the chore commit if it is wrong |
| Run hits the 30-minute timeout | Drive API throttling | Re-run; if it repeats, split the root into smaller class folders |
| Second dispatch says “already running” | Concurrency group is working as intended | Wait for the current run |

## Adding a new resource type

1. Create the folder in Drive under the class's CISCE or Community tree.
2. Add the folder name to the group map in `transform-resources.py`.
3. Run `node scripts/generate-all-resources.js --skip-crawl` after one crawl, check the dataset diff.
4. If the type needs its own colour or card treatment, extend the category map in `src/lib/resources-data.ts` — never hardcode a category name in a component.
