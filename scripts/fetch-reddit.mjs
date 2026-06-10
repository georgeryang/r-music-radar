import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

// Reddit blocks unauthenticated .json with browser-style UAs (returns 403 + HTML wall).
// .rss still serves anonymously with a short, non-browser UA. Keep this string unique.
const UA = 'r-music-tracker/1.0'

const FLAIR_MAP = {
  kpop: [
    { query: 'flair:"MV"', category: 'mv' },
    { query: 'flair:"Album Discussion"', category: 'album' },
    { query: 'flair:"Audio"', category: 'song' },
    { query: 'flair:"Teaser"', category: 'teaser' }
  ],
  popheads: [
    { query: 'flair:"fresh video"', category: 'mv' },
    { query: 'flair:"fresh album"', category: 'album' },
    { query: 'flair:"fresh ep"', category: 'album' },
    { query: 'flair:"[FRESH]"', category: 'song' }
  ]
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#32': ' ' }
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#39|#32|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name, dec, hex) => {
    if (dec) return String.fromCodePoint(parseInt(dec, 10))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    return HTML_ENTITIES[name] || _
  })
}

function parseAtomEntries(xml, category) {
  const posts = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let match
  while ((match = entryRe.exec(xml)) !== null) {
    const entry = match[1]
    const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ''
    const linkHref = (entry.match(/<link[^>]*href="([^"]+)"/) || [])[1] || ''
    const published = (entry.match(/<published>([^<]+)<\/published>/) || [])[1] || ''
    const thumb = (entry.match(/<media:thumbnail[^>]*url="([^"]+)"/) || [])[1] || ''

    if (!linkHref) continue
    posts.push({
      title: decodeEntities(title),
      url: linkHref.replace(/&amp;/g, '&'),
      created_utc: Math.floor(new Date(published).getTime() / 1000),
      thumbnail: thumb ? thumb.replace(/&amp;/g, '&') : '',
      category
    })
  }
  return posts
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function fetchFlair(subreddit, flair) {
  const url = 'https://www.reddit.com/r/' + subreddit + '/search.rss?q=' +
    encodeURIComponent(flair.query) + '&sort=new&restrict_sr=on&t=day&limit=100'

  return new Promise((resolve) => {
    exec(
      `curl -sS -w "\\nHTTP_STATUS:%{http_code}" --max-time 8 -H "User-Agent: ${UA}" "${url}"`,
      { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('Failed: ' + subreddit + '/' + flair.category + ' - ' + (stderr || err.message).substring(0, 300))
          return resolve(null)
        }
        const raw = stdout
        const statusMatch = raw.match(/HTTP_STATUS:(\d+)/)
        const status = statusMatch ? statusMatch[1] : 'unknown'
        const body = raw.replace(/\nHTTP_STATUS:\d+$/, '')
        if (status !== '200') {
          console.error('HTTP ' + status + ' for ' + subreddit + '/' + flair.category + ': ' + body.substring(0, 200))
          return resolve(null)
        }
        try {
          const posts = parseAtomEntries(body, flair.category)
          console.log('OK: ' + subreddit + '/' + flair.category + ' — ' + posts.length + ' posts')
          resolve(posts)
        } catch (parseErr) {
          console.error('Parse error: ' + subreddit + '/' + flair.category + ' - ' + parseErr.message)
          resolve(null)
        }
      }
    )
  })
}

// Reddit soft-throttles bursts of search requests by returning a valid but
// EMPTY feed with HTTP 200 — indistinguishable from "no posts today". So:
// requests run sequentially with spacing (never as a concurrent burst), and an
// empty result is retried with backoff just like a failed one. A flair that is
// genuinely empty costs two extra polite requests; a throttled one recovers.
async function fetchFlairWithRetry(subreddit, flair) {
  const delays = [0, 5000, 15000]
  let last = null
  for (const delay of delays) {
    if (delay) {
      console.log('Retrying ' + subreddit + '/' + flair.category + ' in ' + delay / 1000 + 's (empty or failed)')
      await sleep(delay)
    }
    last = await fetchFlair(subreddit, flair)
    if (last && last.length > 0) return last
  }
  return last
}

async function fetchSubreddit(subreddit) {
  const flairs = FLAIR_MAP[subreddit]
  const results = []
  for (const flair of flairs) {
    results.push(await fetchFlairWithRetry(subreddit, flair))
    // Randomized gap between requests so the sequence has no fixed rhythm.
    await sleep(800 + Math.floor(Math.random() * 1900))
  }

  // A category is "suspect" when every query feeding it came back failed or
  // empty — main() then carries over recent existing posts instead of wiping it.
  const categoryHits = {}
  flairs.forEach((flair, i) => {
    const got = results[i] !== null && results[i].length > 0
    categoryHits[flair.category] = categoryHits[flair.category] || got
  })
  const emptyCategories = Object.keys(categoryHits).filter(c => !categoryHits[c])

  // If nothing at all came back, treat it as a total failure even when every
  // response was a "successful" empty feed — a full throttle must not stamp
  // the data as fresh, or --if-stale would suppress retries for 12h.
  const allFailed = emptyCategories.length === Object.keys(categoryHits).length
  if (allFailed) console.error('All fetches failed or empty for r/' + subreddit)

  const seen = new Set()
  const posts = []
  for (const group of results) {
    if (!group) continue
    for (const post of group) {
      if (!seen.has(post.url)) {
        seen.add(post.url)
        posts.push(post)
      }
    }
  }

  return { posts, allFailed, emptyCategories }
}

async function main() {
  const dataDir = path.join(import.meta.dirname, '..', 'docs', 'data')
  await fs.mkdir(dataDir, { recursive: true })

  const subreddits = Object.keys(FLAIR_MAP)

  let anyTotalFailure = false
  for (const subreddit of subreddits) {
    const { posts, allFailed, emptyCategories } = await fetchSubreddit(subreddit)
    const filePath = path.join(dataDir, subreddit + '.json')
    if (allFailed) {
      anyTotalFailure = true
      console.error('Skipped ' + filePath + ' (all flairs failed — keeping existing)')
      continue
    }

    // Carry over still-recent existing posts for categories the search came
    // back empty on. A post under 24h old that we fetched earlier would still
    // match the t=day search if it were working — so an empty result there is
    // a throttle artifact, not a real "nothing new".
    if (emptyCategories.length > 0) {
      const cutoff = Math.floor(Date.now() / 1000) - 24 * 3600
      try {
        const existing = JSON.parse(await fs.readFile(filePath, 'utf8'))
        let carried = 0
        for (const post of existing.posts) {
          if (emptyCategories.includes(post.category) && post.created_utc >= cutoff &&
              !posts.some(p => p.url === post.url)) {
            posts.push(post)
            carried++
          }
        }
        if (carried > 0) console.log('Carried over ' + carried + ' existing posts for empty categories (' + emptyCategories.join(', ') + ')')
      } catch { /* no existing file — nothing to carry over */ }
    }

    const data = { fetched_at: Date.now(), posts }
    await fs.writeFile(filePath, JSON.stringify(data))
    console.log('Wrote ' + filePath + ' (' + posts.length + ' posts)')
  }

  // Exit non-zero if any subreddit had every flair fail, so update.sh logs the
  // failure instead of silently reporting "no changes".
  if (anyTotalFailure) process.exit(2)
}

main()
