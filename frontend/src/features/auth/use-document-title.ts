import { useEffect } from 'react'

/** Sets `document.title` while mounted (WCAG 2.4.2 page titled). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
