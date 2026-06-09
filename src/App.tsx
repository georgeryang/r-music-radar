import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CategorySection } from '@/components/CategorySection'
import { formatRelativeTime } from '@/lib/utils'
import {
  RELEASE_CATEGORIES,
  SUBREDDITS,
  type Subreddit,
  type SubredditData,
} from '@/lib/types'

type Mode = 'releases' | 'teasers'

// Module-level cache: each subreddit's JSON is fetched once per page load,
// then tab switches are instant.
const cache: Partial<Record<Subreddit, SubredditData>> = {}

export default function App() {
  const [subreddit, setSubreddit] = useState<Subreddit>('kpop')
  const [mode, setMode] = useState<Mode>('releases')
  const [data, setData] = useState<SubredditData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = cache[subreddit]
    if (cached) {
      setData(cached)
      return
    }
    let cancelled = false
    setData(null)
    setError(null)
    // ?v= busts the GitHub Pages CDN cache so a fresh deploy shows up immediately
    fetch(`${import.meta.env.BASE_URL}data/${subreddit}.json?v=${Date.now()}`)
      .then((r) => {
        if (!r.ok) throw new Error('Data not available.')
        return r.json()
      })
      .then((d: SubredditData) => {
        cache[subreddit] = d
        if (!cancelled) setData(d)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Failed to load releases')
      })
    return () => {
      cancelled = true
    }
  }, [subreddit])

  // popheads has no teaser flair, so the mode toggle only exists for kpop
  const effectiveMode = subreddit === 'kpop' ? mode : 'releases'
  const posts = data?.posts ?? []

  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-12">
      <header className="mb-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold">Music Radar</h1>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(data?.fetched_at ?? null)}
          </span>
        </div>
        <Tabs value={subreddit} onValueChange={(v) => setSubreddit(v as Subreddit)}>
          <TabsList className="w-full">
            {SUBREDDITS.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {subreddit === 'kpop' && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="releases">New Releases</TabsTrigger>
              <TabsTrigger value="teasers">Teasers</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </header>

      {error && <p className="py-4 text-sm text-destructive">{error}</p>}
      {!data && !error && <LoadingList />}
      {data &&
        (effectiveMode === 'teasers' ? (
          <CategorySection
            label="Teasers"
            posts={posts.filter((p) => p.category === 'teaser')}
          />
        ) : (
          RELEASE_CATEGORIES.map((c) => (
            // key includes subreddit so collapse state resets when switching tabs
            <CategorySection
              key={`${subreddit}-${c.id}`}
              label={c.label}
              posts={posts.filter((p) => p.category === c.id)}
            />
          ))
        ))}
    </div>
  )
}

function LoadingList() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
  )
}
