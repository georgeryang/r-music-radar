import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { PostCard } from '@/components/PostCard'
import type { Post } from '@/lib/types'

export function CategorySection({ label, posts }: { label: string; posts: Post[] }) {
  const sorted = [...posts].sort((a, b) => b.created_utc - a.created_utc)

  return (
    <Collapsible defaultOpen className="group">
      <CollapsibleTrigger className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/50">
        <h2 className="text-base font-semibold">{label}</h2>
        {posts.length > 0 && <Badge variant="secondary">{posts.length}</Badge>}
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 pb-4">
        {sorted.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nothing yet — check back later!</p>
        ) : (
          sorted.map((post) => <PostCard key={post.url} post={post} />)
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
