#!/usr/bin/env bash
# Push the in-repo wiki source (wiki/*.md) to the GitHub wiki.
#
# GitHub only provisions <repo>.wiki.git after the first page has been created
# in the web UI (Repository -> Wiki -> "Create the first page"). Once that page
# exists, this script is the repeatable way to publish everything in wiki/.
#
# Usage:
#   scripts/push-wiki.sh                 # pushes wiki/*.md to origin's wiki
#   REPO=owner/name scripts/push-wiki.sh # to an explicit repository
set -euo pipefail

REPO="${REPO:-$(git config --get remote.origin.url | sed -E 's#(git@|https://)github.com[:/]##; s#\.git$##')}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> cloning https://github.com/${REPO}.wiki.git"
git clone "https://github.com/${REPO}.wiki.git" "$WORK/wiki"

cp "$ROOT"/wiki/*.md "$WORK/wiki/"
cd "$WORK/wiki"
git add -A
if git diff --cached --quiet; then
  echo "==> wiki already up to date"
  exit 0
fi
git commit -m "Sync wiki from wiki/ in ${REPO}"
git push
echo "==> published: https://github.com/${REPO}/wiki"
