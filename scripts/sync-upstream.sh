#!/usr/bin/env bash
# t3code-pm: rebase the checked-out fork branch onto upstream's main, then prove the fork still holds.
#
#   scripts/sync-upstream.sh              # fetch, rebase, rebuild the lockfile, checks
#   scripts/sync-upstream.sh --continue   # after resolving a conflict: finish the rebase, then the rest
#   UPSTREAM_REMOTE=upstream UPSTREAM_BRANCH=main scripts/sync-upstream.sh
#
# It never pushes. Before rebasing it keeps the old tip as `<branch>-before-sync-<date>`, so
# `git reset --hard <branch>-before-sync-<date>` undoes a sync. When the rebase stops on a
# conflict it lists the conflicted files and which of them hold `t3code-pm:` hunks; resolve them,
# `git add` them and run the copy it names with --continue (or `git rebase --abort`).
set -euo pipefail

# The rebase rewrites or removes this file, so bash parses all of it first and a copy in the git
# dir runs --continue.
{
self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
resume="$(git rev-parse --absolute-git-dir)/sync-upstream.sh"
cd "$(git rev-parse --show-toplevel)"

mode="${1:-sync}"
if [[ "$mode" != sync && "$mode" != --continue ]]; then
  echo "usage: scripts/sync-upstream.sh [--continue]" >&2
  exit 2
fi

# The remote that points at pingdotgg/t3code, so a fork whose origin is itself is never rebased onto itself.
remote="${UPSTREAM_REMOTE:-}"
if [[ -z "$remote" ]]; then
  for candidate in $(git remote); do
    if git remote get-url "$candidate" | grep -Eqi 'github\.com[:/]pingdotgg/t3code(\.git)?/?$'; then
      remote="$candidate"
      break
    fi
  done
fi
if [[ -z "$remote" ]]; then
  echo "sync-upstream: no remote points at pingdotgg/t3code. Add one:" >&2
  echo "  git remote add upstream https://github.com/pingdotgg/t3code.git" >&2
  exit 1
fi
upstream_branch="${UPSTREAM_BRANCH:-main}"
upstream="$remote/$upstream_branch"

rebasing() {
  [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]
}

stop_on_conflict() {
  echo "sync-upstream: the rebase stopped on a conflict in $(git log -1 --format='%h %s' REBASE_HEAD 2>/dev/null)." >&2
  echo
  echo "Conflicted files:"
  git diff --name-only --diff-filter=U | while IFS= read -r file; do
    case "$file" in
      pnpm-lock.yaml) echo "  $file   (take either side: git checkout --ours $file; the script rebuilds it)" ;;
      *.gen.ts) echo "  $file   (generated: take upstream's side, git checkout --ours $file; the typecheck flags a missing fork route)" ;;
      *)
        if grep -q "t3code-pm" "$file" 2>/dev/null; then
          echo "  $file   (has t3code-pm: hunks; keep upstream's change and re-add the marked lines)"
        else
          echo "  $file"
        fi
        ;;
    esac
  done
  echo
  echo "Resolve, git add <files>, then: bash $resume --continue   (or git rebase --abort)"
  exit 1
}

if [[ "$mode" == sync ]]; then
  if rebasing; then
    echo "sync-upstream: a rebase is in progress. Finish it with --continue, or git rebase --abort." >&2
    exit 1
  fi
  if ! branch="$(git symbolic-ref --short -q HEAD)"; then
    echo "sync-upstream: check out the fork's branch first." >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "sync-upstream: commit, stash (-u) or remove your changes and untracked files first." >&2
    git status --short >&2
    exit 1
  fi

  echo "sync-upstream: fetching $upstream ($(git remote get-url "$remote"))"
  git fetch "$remote" "$upstream_branch"

  if [[ "$self" != "$resume" ]]; then
    cp "$self" "$resume"
  fi
  backup="$branch-before-sync-$(date +%Y%m%d-%H%M%S)"
  git branch "$backup" HEAD
  echo "sync-upstream: kept the old tip of $branch as $backup"
  echo "sync-upstream: replaying $(git rev-list --count "$upstream"..HEAD) fork commits onto $(git rev-list --count HEAD.."$upstream") new upstream commits"
  git rebase "$upstream" || stop_on_conflict
elif rebasing; then
  GIT_EDITOR=true git rebase --continue || stop_on_conflict
fi

branch="$(git symbolic-ref --short HEAD)"
base="$(git merge-base HEAD "$upstream")"
echo "sync-upstream: $branch sits on $upstream ($(git rev-parse --short "$base"))"

# Git merges pnpm-lock.yaml as text and can leave a lockfile pnpm rejects, so rebuild it from
# upstream's and fold any change into the fork commit that owns the lockfile edits.
git checkout "$base" -- pnpm-lock.yaml
vp i
if ! git diff --quiet HEAD -- pnpm-lock.yaml; then
  owner="$(git log -1 --format=%H "$base"..HEAD -- pnpm-lock.yaml)"
  if [[ -z "$owner" ]]; then
    git commit -m "chore(pm): rebuild pnpm-lock.yaml on $upstream" -- pnpm-lock.yaml
  else
    git commit -q --fixup="$owner" -- pnpm-lock.yaml
    GIT_SEQUENCE_EDITOR=: git rebase -q -i --autosquash "$base"
  fi
  echo "sync-upstream: rebuilt pnpm-lock.yaml"
fi
echo "sync-upstream: $(git grep -l 't3code-pm:' -- ':!*.md' ':!scripts/sync-upstream.sh' | wc -l | tr -d ' ') files carry t3code-pm: marks"

failed=""
check() {
  local name="$1"
  shift
  echo "sync-upstream: $name"
  if ! "$@"; then
    failed="$failed
  $name"
  fi
}
# Format, lint, knip, typecheck of every affected package and the tests beside every fork change.
check "fast CI checks on the fork's diff" vp run check:changed "$base"
check "mobile dependency graph" vp test run apps/mobile/src/dependency-graph.test.ts
check "PM translation catalogs" node scripts/pm-i18n.ts check
check "upstream translation catalogs" vp run i18n:check

backup="$(git for-each-ref --sort=-creatordate --count=1 --format='%(refname:short)' "refs/heads/$branch-before-sync-*")"
if [[ -n "$backup" ]]; then
  echo "sync-upstream: review the resolutions with"
  echo "  git range-diff $(git merge-base "$backup" "$base" | cut -c1-12)..$backup $(git rev-parse --short "$base")..HEAD"
fi
if [[ -n "$failed" ]]; then
  echo "sync-upstream: failed:$failed" >&2
  echo "A failure can be upstream's own: run the same test on $upstream before fixing it here." >&2
  exit 1
fi
echo "sync-upstream: done. Nothing was pushed."
exit
}
