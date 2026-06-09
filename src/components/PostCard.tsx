import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { formatPostDate } from '@/lib/utils'
import type { Post } from '@/lib/types'

// Reddit uses sentinel strings ('self', 'default') instead of real URLs for
// posts without a thumbnail.
function hasRealThumbnail(post: Post) {
  return (
    post.thumbnail.startsWith('http') &&
    !post.thumbnail.includes('self') &&
    !post.thumbnail.includes('default')
  )
}

export function PostCard({ post }: { post: Post }) {
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = hasRealThumbnail(post) && !imgFailed

  return (
    <a href={post.url} target="_blank" rel="noopener noreferrer" className="block">
      <Card className="flex-row items-center gap-3 p-3 transition-colors hover:bg-accent">
        {showImg ? (
          <img
            src={post.thumbnail}
            alt=""
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="size-14 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-2xl">
            🔥
          </div>
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug">{post.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{formatPostDate(post.created_utc)}</p>
        </div>
      </Card>
    </a>
  )
}
