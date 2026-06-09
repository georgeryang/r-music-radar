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

async function fetchSubreddit(subreddit) {
  const flairs = FLAIR_MAP[subreddit]
  const results = await Promise.all(flairs.map(f => fetchFlair(subreddit, f)))

  const failures = results.filter(r => r === null).length
  const allFailed = failures === flairs.length
  if (allFailed) console.error('All fetches failed for r/' + subreddit)

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

  return { posts, allFailed }
}

async function main() {
  const dataDir = path.join(import.meta.dirname, '..', 'docs', 'data')
  await fs.mkdir(dataDir, { recursive: true })

  const subreddits = Object.keys(FLAIR_MAP)
  const results = await Promise.all(subreddits.map(s => fetchSubreddit(s)))

  let anyTotalFailure = false
  await Promise.all(subreddits.map(async (subreddit, i) => {
    const { posts, allFailed } = results[i]
    const filePath = path.join(dataDir, subreddit + '.json')
    if (allFailed) {
      anyTotalFailure = true
      console.error('Skipped ' + filePath + ' (all flairs failed — keeping existing)')
      return
    }
    const data = { fetched_at: Date.now(), posts }
    await fs.writeFile(filePath, JSON.stringify(data))
    console.log('Wrote ' + filePath + ' (' + posts.length + ' posts)')
  }))

  // Exit non-zero if any subreddit had every flair fail, so update.sh logs the
  // failure instead of silently reporting "no changes".
  if (anyTotalFailure) process.exit(2)
}

main()
