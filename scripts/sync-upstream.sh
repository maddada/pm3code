#!/usr/bin/env bash
# t3code-pm: rebase the `pm` branch onto upstream's main, then prove the fork still holds.
#
#   scripts/sync-upstream.sh            # fetch, rebase, install, PM tests, typecheck
#   UPSTREAM_REMOTE=upstream scripts/sync-upstream.sh
#
# It never pushes. Before rebasing it keeps the old tip as `pm-before-sync-<date>`, so
# `git reset --hard pm-before-sync-<date>` undoes a sync. When the rebase stops on a conflict it
# lists the conflicted files and which of them hold `t3code-pm:` hunks, then leaves the rebase for
# you (`git rebase --continue` or `git rebase --abort`).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if git remote get-url upstream >/dev/null 2>&1; then
  default_remote=upstream
else
  default_remote=origin
fi
remote="${UPSTREAM_REMOTE:-$default_remote}"
upstream_branch="${UPSTREAM_BRANCH:-main}"
branch="$(git rev-parse --abbrev-ref HEAD)"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "sync-upstream: commit or stash your changes first." >&2
  exit 1
fi

echo "sync-upstream: fetching $remote/$upstream_branch"
git fetch "$remote" "$upstream_branch"

backup="pm-before-sync-$(date +%Y%m%d-%H%M%S)"
git branch "$backup" HEAD
echo "sync-upstream: kept the old tip of $branch as $backup"

list_conflicts() {
  local files
  files="$(git diff --name-only --diff-filter=U)"
  if [[ -z "$files" ]]; then
    return
  fi
  echo
  echo "Conflicted files:"
  while IFS= read -r file; do
    if grep -q "t3code-pm" "$file" 2>/dev/null; then
      echo "  $file   (has t3code-pm: hunks; keep upstream's change and re-add the marked line)"
    else
      echo "  $file"
    fi
  done <<<"$files"
  echo
  echo "Resolve, then: git add <files> && git rebase --continue   (or git rebase --abort)"
}

if ! git rebase "$remote/$upstream_branch"; then
  echo "sync-upstream: the rebase stopped on a conflict." >&2
  list_conflicts
  exit 1
fi

echo "sync-upstream: rebased $branch onto $remote/$upstream_branch"
echo "sync-upstream: $(git grep -c 't3code-pm:' -- ':!*.md' ':!scripts/sync-upstream.sh' | wc -l | tr -d ' ') files carry t3code-pm: marks"

vp i

echo "sync-upstream: PM tests"
vp test run packages/pm apps/server/src/pm apps/web/src/pm

echo "sync-upstream: typecheck of the packages PM touches"
for dir in packages/contracts packages/pm packages/client-runtime apps/server apps/web apps/desktop; do
  (cd "$dir" && vp run typecheck)
done

echo "sync-upstream: translation catalogs"
node scripts/pm-i18n.ts check
vp run i18n:check

echo "sync-upstream: done. Nothing was pushed; review with git log $backup..HEAD"
