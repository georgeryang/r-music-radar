# Music Radar

New music releases from r/kpop and r/popheads, categorized by post flair
(music videos / albums & EPs / songs / teasers). Live at
https://georgeryang.github.io/r-music-radar/

Successor to r-music-tracker. Data is fetched from Reddit's search RSS feeds
(the JSON API and all cloud fetching get blocked — only local fetching from a
residential IP works), published daily by launchd, and served as static files
from GitHub Pages.

## How it fits together

- `scripts/fetch-reddit.mjs` — fetches each flair's RSS feed via curl, writes `docs/data/{kpop,popheads}.json`. Zero dependencies.
- `scripts/update.sh` — fetch, then commit + push `docs/data` if anything changed. Run by launchd daily at 18:30 (also: `npm run update`).
- `docs/` — the GitHub Pages root (Settings → Pages → main branch, /docs folder). Contains the built app **and** the data. Builds never touch `docs/data` (`emptyOutDir: false`), so the launchd job needs no node_modules.
- `src/` — Vite + React + Tailwind + shadcn frontend. Data is fetched client-side, so data updates need no rebuild.

## Commands

```sh
npm run dev      # local dev server
npm run build    # type-check + build into docs/ (commit docs/ to deploy)
npm run fetch    # fetch Reddit data only
npm run update   # fetch + commit + push (what launchd runs)
```

## launchd install

```sh
cp launchd/com.georgeryang.r-music-radar.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.georgeryang.r-music-radar.plist
```

Run it on demand: `launchctl kickstart gui/$UID/com.georgeryang.r-music-radar`
Logs: `~/Library/Logs/r-music-radar.log`

## Troubleshooting

- **Fetch fails with HTTP 403/429:** Reddit is rate-limiting; it usually passes on the next run. The script keeps existing data when all flairs for a subreddit fail.
- **Push fails from launchd:** make sure the SSH key works without a prompt: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.
- **Site shows stale data:** GitHub Pages deploys take ~1 minute after push; the app cache-busts with `?v=`, so a reload after that is enough.
