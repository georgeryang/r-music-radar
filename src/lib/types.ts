// Data contract between scripts/fetch-reddit.mjs (producer) and the app (consumer).
// Categories come straight from Reddit post flairs — see FLAIR_MAP in the fetch script.

export type Category = 'mv' | 'album' | 'song' | 'teaser'

export interface Post {
  title: string
  url: string
  created_utc: number // unix seconds
  thumbnail: string // '' when the post has none
  category: Category
}

export interface SubredditData {
  fetched_at: number // ms epoch
  posts: Post[]
}

export type Subreddit = 'kpop' | 'popheads'

export const SUBREDDITS: { id: Subreddit; label: string }[] = [
  { id: 'kpop', label: 'r/kpop' },
  { id: 'popheads', label: 'r/popheads' },
]

export const RELEASE_CATEGORIES: { id: Category; label: string }[] = [
  { id: 'mv', label: 'Music Videos' },
  { id: 'album', label: 'Albums & EPs' },
  { id: 'song', label: 'Songs' },
]
