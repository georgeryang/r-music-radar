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

Successor to r-music-tracker. Data comes from Reddit's search RSS feeds
(the JSON API and all cloud fetching get blocked — only local fetching from a
residential IP works), published daily by launchd, served as static files
from GitHub Pages.

- `scripts/fetch-reddit.mjs` — fetches each flair's RSS feed via curl, writes `docs/data/{kpop,popheads}.json`. Zero dependencies. Requests run one at a time with randomized gaps, retry when a response comes back empty, and carry over recent posts for a category that stays empty — Reddit soft-throttles bursts by returning a *valid empty feed with HTTP 200*, so an empty result can't be trusted at face value.
- `scripts/update.sh` — fetch, then commit + push `docs/data` if anything changed. launchd runs it with `--if-stale`, which exits early (silently) unless the last fetch predates the most recent 18:15 KST — that's what turns frequent ticks into one fetch per day and makes wake/login catch-up free. Stale runs wait a random 0–7 min before fetching. KST is UTC+9 with no DST, so the check is plain UTC arithmetic, independent of the Mac's timezone.
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

- **Fetch fails with HTTP 403/429:** Reddit is rate-limiting; it usually passes on the next run. The script keeps existing data when all flairs for a subreddit fail.
- **A category looks empty when Reddit clearly has posts:** Reddit soft-throttled the search — it returns an empty feed with HTTP 200. The script retries and carries over recent posts; `Carried over N existing posts` in the log means this is happening. If it persists across days, the fetch may need longer gaps between requests.
- **Push fails from launchd:** make sure the SSH key works without a prompt: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.
- **Site shows stale data:** GitHub Pages deploys take ~1 minute after push; the app cache-busts with `?v=`, so a reload after that is enough.
