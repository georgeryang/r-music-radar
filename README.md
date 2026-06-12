# Music Radar

New music releases from r/kpop and r/popheads, categorized by post flair
(music videos / albums & EPs / songs / teasers). Live at
https://georgeryang.github.io/r-music-radar/

## How to use (no technical knowledge needed)

**Where to look.** Open https://georgeryang.github.io/r-music-radar/ on your
phone or computer. On iPhone, tap Share → "Add to Home Screen" and it opens
like a regular app.

**It updates itself.** Once a day, right after 6:15pm *Korea time* — just
after the Korean evening release window, which is early morning here. Nothing
needs to be open or running — no app, no window, no browser.

- Mac **asleep** (lid closed) at that hour — the usual case? It catches up
  the moment you wake it, so the morning's first look always has last
  evening's Korean releases.
- Mac **shut off**? It catches up the next time you log in.

**Restarting your computer: nothing to do.** The updater is registered with
macOS itself (in `~/Library/LaunchAgents`), so it comes back automatically
every time you log in — it also does a check right at login and refreshes
then if an update was missed. There is nothing to launch, start, or
double-click after a restart. This keeps working until you deliberately
remove it (see "launchd install" below); restarts, updates to macOS, and
weeks of the Mac being off don't break it.

**Update it right now (optional).** Double-click `refresh.command` in this
folder. A window opens and shows what it's doing; when it says "Published",
the website has the new data about a minute later. Press Enter to close the
window. You never *have* to do this — it's only for when you don't want to
wait for the automatic update.

**How to tell it's working.** The website header says "Updated 2h ago" (etc).
If that number ever looks too old, double-click `refresh.command`.

---

*Everything below is technical detail — only needed for changing how it works.*

## How it fits together

Successor to r-music-tracker. Data comes from old.reddit.com's HTML `/new`
listings (the JSON API and all cloud fetching get blocked, and per-flair RSS
searches get rate-limited with HTTP 429 — only low-volume local fetching from
a residential IP works), published daily by launchd, served as static files
from GitHub Pages.

- `scripts/fetch-reddit.mjs` — fetches each subreddit's `/new` listing from old.reddit.com via curl (one request per subreddit, plus one more page when 100 posts don't cover 24h), reads each post's flair from the HTML, and writes `docs/data/{kpop,popheads}.json`. Zero dependencies. Requests run one at a time with randomized gaps; a response with no parseable posts is retried with backoff (Reddit's throttle artifacts can look like a "successful" empty page), and recent posts from the previous file are carried over so a truncated fetch never drops posts we already had.
- `scripts/update.sh` — fetch, then commit + push `docs/data` if anything changed — including partial data when one subreddit failed, so a good fetch is never held hostage by a bad one. launchd runs it with `--if-stale`, which exits early (silently) unless the oldest data file predates the most recent 18:15 KST — that's what turns frequent ticks into one fetch per day, makes wake/login catch-up free, and retries later the same day after a partial failure. Stale runs wait a random 0–7 min before fetching. KST is UTC+9 with no DST, so the check is plain UTC arithmetic, independent of the Mac's timezone.
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

The agent ticks every 10 minutes (`StartInterval: 600`) and once at every
login (`RunAtLoad`). Almost every tick is a silent no-op — the `--if-stale`
guard in update.sh allows exactly one fetch per day, anchored to 18:15 KST.
When the Mac sleeps through that moment, launchd fires the missed tick once
on wake, so the fetch happens at lid-open instead. A fixed
`StartCalendarInterval` can't do this: it only understands the Mac's local
timezone, which drifts against KST with DST changes. After editing the
plist, reload: `launchctl bootout gui/$UID/com.georgeryang.r-music-radar`,
then the two commands above again.

Lifecycle: installing is one-time. launchd reloads every plist in
`~/Library/LaunchAgents` at each login, so the agent survives restarts,
shutdowns, and macOS updates with no action needed. It only stops if the
plist is removed from `~/Library/LaunchAgents`, you run `launchctl bootout`,
or this repo folder moves/renames (the plist points at absolute paths —
reinstall with updated paths if you move the project). To check it's loaded:
`launchctl list | grep r-music-radar`.

Run it on demand: `launchctl kickstart gui/$UID/com.georgeryang.r-music-radar`
Logs: `~/Library/Logs/r-music-radar.log` — only fetches are logged (skipped
ticks are silent), so one entry per day is healthy, not broken.

## Troubleshooting

- **Fetch fails with HTTP 403/429:** Reddit is rate-limiting; it usually passes on the next run. The script keeps a subreddit's existing data when its fetch fails, publishes whatever else succeeded, and the `--if-stale` guard retries the failed subreddit on a later tick the same day.
- **A category looks empty when Reddit clearly has posts:** check the post's flair on old.reddit.com — only flairs in `FLAIR_MAP` (matched exactly, brackets included) are kept. If the subreddit renamed a flair, update the map. `Carried over N existing posts` in the log is normal after a partial fetch.
- **Push fails from launchd:** make sure the SSH key works without a prompt: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.
- **Site shows stale data:** GitHub Pages deploys take ~1 minute after push; the app cache-busts with `?v=`, so a reload after that is enough.
