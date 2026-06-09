#!/bin/bash
# Daily fetch + publish, run by launchd (see launchd/com.georgeryang.r-music-radar.plist).
# Needs no node_modules — just node, curl, and git.
set -uo pipefail

REPO_DIR="/Users/gyang/Dev/r-music-radar"
cd "$REPO_DIR" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# launchd's PATH doesn't include nvm; fall back to the newest installed node.
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ]; then
  log "ERROR: node not found"
  exit 1
fi

# --if-stale (passed by launchd): skip unless the last fetch is >20h old. Lets
# RunAtLoad catch up after a powered-off 18:30 without refetching on every login.
if [ "${1:-}" = "--if-stale" ]; then
  AGE_HOURS="$("$NODE" -p '
    try {
      const { fetched_at } = JSON.parse(require("fs").readFileSync("docs/data/kpop.json", "utf8"));
      Math.floor((Date.now() - fetched_at) / 3600000);
    } catch { 999 }
  ' 2>/dev/null || echo 999)"
  if [ "$AGE_HOURS" -lt 20 ] 2>/dev/null; then
    log "Data is fresh (${AGE_HOURS}h old) — skipping"
    exit 0
  fi
  log "Data is stale (${AGE_HOURS}h old) — refreshing"
fi

log "Fetching Reddit data..."
if ! "$NODE" scripts/fetch-reddit.mjs; then
  log "ERROR: fetch failed for at least one subreddit (kept existing data)"
  exit 1
fi

if git diff --quiet docs/data && [ -z "$(git ls-files --others --exclude-standard docs/data)" ]; then
  log "No changes — nothing to publish"
  exit 0
fi

log "Publishing..."
git add docs/data
git commit -m "Update data $(date '+%Y-%m-%d %H:%M')" || { log "ERROR: commit failed"; exit 1; }
git push || { log "ERROR: push failed"; exit 1; }
log "Published"
