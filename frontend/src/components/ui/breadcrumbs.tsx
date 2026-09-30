import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'

export interface Crumb {
  label: React.ReactNode
  href?: string
}

/**
 * Breadcrumbs (UX-006 navigation, UX-004). A labelled <nav> with an ordered
 * list; the current page is the last item and is marked aria-current, not a
 * link. Separators are decorative (aria-hidden).
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[]
  className?: string
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn('text-body-sm', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <Fragment key={i}>
              <li>
                {item.href && !last ? (
                  <a
                    href={item.href}
                    className="underline hover:text-text focus-visible:outline-focus-ring"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={last ? 'text-text' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true">
                  <ChevronRight className="size-4" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
