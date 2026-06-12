import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

// Reddit blocks unauthenticated .json with browser-style UAs (returns 403 + HTML
// wall), and heavily rate-limits bursts of search.rss queries (HTTP 429). The
// old.reddit.com HTML listing still serves anonymously with a short non-browser
// UA, and unlike RSS it includes each post's flair — so ONE request per
// subreddit replaces one search per flair. Keep the UA string unique.
const UA = 'r-music-tracker/1.0'

// Exact flair label (as rendered on old.reddit) → category. Posts with any
// other flair are ignored. Exact matching also fixes the search-era bug where
// flair:"[FRESH]" fuzzy-matched "[FRESH ALBUM]" posts into the song category.
const FLAIR_MAP = {
  kpop: {
    '[MV]': 'mv',
    '[Album Discussion]': 'album',
    '[Audio]': 'song',
    '[Teaser]': 'teaser'
  },
  popheads: {
    '[FRESH VIDEO]': 'mv',
    '[FRESH ALBUM]': 'album',
    '[FRESH EP]': 'album',
    '[FRESH]': 'song'
  }
}

const WINDOW_SECONDS = 24 * 3600 // same horizon the old t=day searches had
const MAX_PAGES = 3 // 100 posts/page; r/kpop can exceed 100 posts in 24h

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#32': ' ' }
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#39|#32|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name, dec, hex) => {
    if (dec) return String.fromCodePoint(parseInt(dec, 10))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    return HTML_ENTITIES[name] || _
  })
}

// Each post on an old.reddit listing is a div.thing whose opening tag carries
// data-timestamp / data-permalink / data-fullname attributes; flair, title and
// thumbnail live in the markup between one opening tag and the next.
function parseListing(html, flairMap) {
  const tags = [...html.matchAll(/<div class="([^"]*\bthing\b[^"]*)"[^>]*>/g)]
  const posts = []
  let lastFullname = ''
  let oldestUtc = Infinity

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i][0]
    const classAttr = tags[i][1]
    const body = html.slice(tags[i].index, i + 1 < tags.length ? tags[i + 1].index : html.length)

    const fullname = (tag.match(/data-fullname="([^"]+)"/) || [])[1] || ''
    if (fullname) lastFullname = fullname
    if (/\bpromoted\b/.test(classAttr)) continue // ads

    const timestamp = (tag.match(/data-timestamp="(\d+)"/) || [])[1]
    const permalink = (tag.match(/data-permalink="([^"]+)"/) || [])[1]
    if (!timestamp || !permalink) continue
    const createdUtc = Math.floor(Number(timestamp) / 1000)
    if (createdUtc < oldestUtc) oldestUtc = createdUtc

    const flair = (body.match(/linkflairlabel[^>]*title="([^"]*)"/) || [])[1] || ''
    const category = flairMap[decodeEntities(flair)]
    if (!category) continue

    const titleHtml = (body.match(/<a class="title[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ''
    const thumb = (body.match(/<a class="thumbnail[^"]*"[^>]*>\s*<img src="([^"]*)"/) || [])[1] || ''

    posts.push({
      title: decodeEntities(titleHtml.replace(/<[^>]*>/g, '')),
      url: 'https://www.reddit.com' + decodeEntities(permalink),
      created_utc: createdUtc,
      thumbnail: thumb ? decodeEntities(thumb).replace(/^\/\//, 'https://') : '',
      category
    })
  }

  return { posts, count: tags.length, lastFullname, oldestUtc }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fetchPage(subreddit, after) {
  const url = 'https://old.reddit.com/r/' + subreddit + '/new/?limit=100' +
    (after ? '&after=' + after : '')

  return new Promise((resolve) => {
    exec(
      `curl -sS -w "\\nHTTP_STATUS:%{http_code}" --max-time 15 -H "User-Agent: ${UA}" "${url}"`,
      { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('Failed: ' + subreddit + ' - ' + (stderr || err.message).substring(0, 300))
          return resolve(null)
        }
        const statusMatch = stdout.match(/HTTP_STATUS:(\d+)/)
        const status = statusMatch ? statusMatch[1] : 'unknown'
        const body = stdout.replace(/\nHTTP_STATUS:\d+$/, '')
        if (status !== '200') {
          console.error('HTTP ' + status + ' for ' + subreddit + ': ' + body.substring(0, 200))
          return resolve(null)
        }
        resolve(body)
      }
    )
  })
}

// A 200 with no parseable posts is a throttle/anti-bot artifact, not an empty
// subreddit — treat it like a failure and retry with backoff.
async function fetchPageWithRetry(subreddit, after, flairMap) {
  const delays = [0, 10000, 30000]
  for (const delay of delays) {
    if (delay) {
      console.log('Retrying ' + subreddit + ' in ' + delay / 1000 + 's (empty or failed)')
      await sleep(delay)
    }
    const html = await fetchPage(subreddit, after)
    if (html) {
      const parsed = parseListing(html, flairMap)
      if (parsed.count > 0) return parsed
      console.error('Parsed 0 posts for ' + subreddit + ' (HTTP 200 but no listing)')
    }
  }
  return null
}

// Fetch /new pages until the listing reaches past the 24h window (usually one
// page; r/kpop sometimes needs two on busy days).
async function fetchSubreddit(subreddit) {
  const flairMap = FLAIR_MAP[subreddit]
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SECONDS
  const posts = []
  let after = ''

  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = await fetchPageWithRetry(subreddit, after, flairMap)
    if (!parsed) {
      // Page 1 failing means we got nothing: total failure. A later page
      // failing just truncates coverage — keep what we have and let the
      // carryover merge backfill from the previous file.
      if (page === 1) return { posts: null }
      console.error('Page ' + page + ' failed for ' + subreddit + ' — keeping partial listing')
      break
    }
    posts.push(...parsed.posts.filter((p) => p.created_utc >= cutoff))
    console.log('OK: ' + subreddit + ' page ' + page + ' — ' + parsed.count + ' posts scanned, ' +
      posts.length + ' matched so far')
    if (parsed.oldestUtc < cutoff || !parsed.lastFullname || parsed.count < 100) break
    after = parsed.lastFullname
    await sleep(800 + Math.floor(Math.random() * 1900))
  }

  return { posts }
}

async function main() {
  const dataDir = path.join(import.meta.dirname, '..', 'docs', 'data')
  await fs.mkdir(dataDir, { recursive: true })

  let anyTotalFailure = false
  for (const subreddit of Object.keys(FLAIR_MAP)) {
    const { posts } = await fetchSubreddit(subreddit)
    const filePath = path.join(dataDir, subreddit + '.json')
    if (posts === null) {
      anyTotalFailure = true
      console.error('Skipped ' + filePath + ' (fetch failed — keeping existing)')
      continue
    }

    // Merge still-recent posts from the previous file that this listing no
    // longer shows (fell past a failed page, or removed from /new). Keeps a
    // truncated fetch from silently dropping posts we already had.
    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SECONDS
    try {
      const existing = JSON.parse(await fs.readFile(filePath, 'utf8'))
      let carried = 0
      for (const post of existing.posts) {
        if (post.created_utc >= cutoff && !posts.some((p) => p.url === post.url)) {
          posts.push(post)
          carried++
        }
      }
      if (carried > 0) console.log('Carried over ' + carried + ' existing posts for ' + subreddit)
    } catch { /* no existing file — nothing to carry over */ }

    posts.sort((a, b) => b.created_utc - a.created_utc)
    const data = { fetched_at: Date.now(), posts }
    await fs.writeFile(filePath, JSON.stringify(data))
    console.log('Wrote ' + filePath + ' (' + posts.length + ' posts)')

    await sleep(800 + Math.floor(Math.random() * 1900))
  }

  // Exit non-zero if any subreddit failed outright, so update.sh logs the
  // failure instead of silently reporting "no changes".
  if (anyTotalFailure) process.exit(2)
}

main()
