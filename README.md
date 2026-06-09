# Music Radar

New music releases from r/kpop and r/popheads, categorized by post flair
(music videos / albums & EPs / songs / teasers). Live at
https://georgeryang.github.io/r-music-radar/

## How to use (no technical knowledge needed)

**Where to look.** Open https://georgeryang.github.io/r-music-radar/ on your
phone or computer. On iPhone, tap Share → "Add to Home Screen" and it opens
like a regular app.

**It updates itself.** Every day at 6:30pm the Mac fetches the latest posts
and updates the website. Nothing needs to be open or running — no app, no
window, no browser.

- Mac **asleep** (lid closed) at 6:30pm? It catches up as soon as you wake it.
- Mac **shut off** at 6:30pm? It catches up the next time you log in.

**Update it right now.** Double-click `refresh.command` in this folder. A
window opens and shows what it's doing; when it says "Published", the website
has the new data about a minute later. Press Enter to close the window.

**How to tell it's working.** The website header says "Updated 2h ago" (etc).
If that number ever looks too old, double-click `refresh.command`.

---

*Everything below is technical detail — only needed for changing how it works.*

## How it fits together

Successor to r-music-tracker. Data comes from Reddit's search RSS feeds
(the JSON API and all cloud fetching get blocked — only local fetching from a
residential IP works), published daily by launchd, served as static files
from GitHub Pages.

- `scripts/fetch-reddit.mjs` — fetches each flair's RSS feed via curl, writes `docs/data/{kpop,popheads}.json`. Zero dependencies.
- `scripts/update.sh` — fetch, then commit + push `docs/data` if anything changed. launchd runs it with `--if-stale`, which exits early unless the last fetch is >20h old (this is what makes login catch-up free).
- `refresh.command` — double-clickable wrapper around `update.sh` (no `--if-stale`, so it always fetches).
- `docs/` — the GitHub Pages root (Settings → Pages → main branch, /docs folder). Contains the built app **and** the data. Builds never touch `docs/data` (`emptyOutDir: false`), so the launchd job needs no node_modules.
- `src/` — Vite + React + Tailwind + shadcn frontend. Data is fetched client-side, so data updates need no rebuild.

## Commands

```sh
npm run dev      # local dev server
npm run build    # type-check + build into docs/ (commit docs/ to deploy)
npm run fetch    # fetch Reddit data only
npm run update   # fetch + commit + push (what launchd runs, minus --if-stale)
```

## launchd install

```sh
cp launchd/com.georgeryang.r-music-radar.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.georgeryang.r-music-radar.plist
```

The agent runs daily at 18:30 and once at every login (the `--if-stale` guard
makes login runs a no-op when data is fresh). After editing the plist, reload:
`launchctl bootout gui/$UID/com.georgeryang.r-music-radar`, then the two
commands above again.

Run it on demand: `launchctl kickstart gui/$UID/com.georgeryang.r-music-radar`
Logs: `~/Library/Logs/r-music-radar.log`

## Troubleshooting

- **Fetch fails with HTTP 403/429:** Reddit is rate-limiting; it usually passes on the next run. The script keeps existing data when all flairs for a subreddit fail.
- **Push fails from launchd:** make sure the SSH key works without a prompt: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.
- **Site shows stale data:** GitHub Pages deploys take ~1 minute after push; the app cache-busts with `?v=`, so a reload after that is enough.
