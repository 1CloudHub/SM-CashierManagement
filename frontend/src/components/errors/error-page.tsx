import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { StateBlock, type StateVariant } from '@/components/ui/state-block'
import { cn } from '@/lib/utils'
import {
  resolveActionLabels,
  resolveAnnouncements,
  resolveErrorCopy,
  type ErrorKind,
  type Locale,
  type RecoveryAction,
} from './messages'
import { generateReferenceId, kindHasReference } from './reference-id'

/**
 * ErrorPage (SCR-090, UX-010, req. 2 & 24).
 *
 * A single, token-driven component that renders every request-level error and
 * status state — 400 / 401 / 403 / 404 / 429 / 500 / 503 and offline — from the
 * shared StateBlock primitive. Each page:
 *
 *  - shows a plain-language, localised (en/fil) message — never a stack trace,
 *    object detail or leaked attribute (403 reveals nothing about its target);
 *  - carries a reference id where it helps support (400/429/500/503/offline),
 *    generated if the caller doesn't supply one;
 *  - always offers a clear way back to safety — Home, the previous safe screen,
 *    sign-in, search or retry — so there is NO dead end;
 *  - is announced to assistive tech: StateBlock renders role="alert"
 *    (assertive) for error/offline and role="status" (polite) otherwise, and
 *    the heading is prefixed with a visually-hidden "Error page:" cue.
 *
 * Layout: authenticated errors render inside the app shell (Home is one click),
 * so those callers place <ErrorPage> in the content region. 401 and any
 * pre-auth failure use `bare`, which centres the block on a plain background
 * with no shell around it.
 */

/** Which StateBlock variant (and therefore live-region politeness) a kind uses. */
const KIND_VARIANT: Record<ErrorKind, StateVariant> = {
  '400': 'error',
  '401': 'no-access',
  '403': 'no-access',
  '404': 'empty',
  '429': 'error',
  '500': 'error',
  '503': 'error',
  offline: 'offline',
}

/**
 * Default recovery actions per kind (ordered; first is the primary). Every kind
 * has at least one, guaranteeing no dead end. Callers can override via
 * `actions` and wire real handlers/links through `onAction` / `hrefs`.
 */
const KIND_ACTIONS: Record<ErrorKind, RecoveryAction[]> = {
  '400': ['back', 'home'],
  '401': ['signIn'],
  '403': ['home'],
  '404': ['home', 'search'],
  '429': ['retry', 'home'],
  '500': ['retry', 'home'],
  '503': ['retry', 'home'],
  offline: ['retry'],
}

/** Actions that are navigations (rendered as links when an href is given). */
const NAV_ACTIONS: ReadonlySet<RecoveryAction> = new Set<RecoveryAction>([
  'home',
  'signIn',
  'search',
])

export interface ErrorPageProps {
  kind: ErrorKind
  locale?: Locale
  /**
   * Support reference. Supplied by the caller (e.g. from a failed response
   * header) or generated for the kinds that warrant one. Pass `null` to force
   * it off.
   */
  referenceId?: string | null
  /** Override the default recovery actions for this kind. */
  actions?: RecoveryAction[]
  /** Hrefs for navigation actions; defaults keep the app self-contained. */
  hrefs?: Partial<Record<'home' | 'signIn' | 'search', string>>
  /** Handlers for button actions (retry, back) and optional nav interception. */
  onAction?: (action: RecoveryAction) => void
  /** `bare` centres the block full-screen (pre-auth / 401); `inline` sits in the shell. */
  layout?: 'inline' | 'bare'
  /**
   * Heading level of the error title. Defaults to 1 for `bare` (the block is
   * the whole page) and 2 for `inline`. A screen whose only content is this
   * page passes 1 so the error title is the page's single h1.
   */
  headingLevel?: 1 | 2
  className?: string
}

const DEFAULT_HREFS = {
  home: '/',
  signIn: '/sign-in',
  search: '/search',
} as const

export function ErrorPage({
  kind,
  locale = 'en',
  referenceId,
  actions,
  hrefs,
  onAction,
  layout = 'inline',
  headingLevel = layout === 'bare' ? 1 : 2,
  className,
}: ErrorPageProps) {
  const copy = resolveErrorCopy(kind, locale)
  const labels = resolveActionLabels(locale)
  const a11y = resolveAnnouncements(locale)
  const variant = KIND_VARIANT[kind]
  const actionList = actions ?? KIND_ACTIONS[kind]

  // Resolve the reference id once per mount so it is stable across re-renders.
  const resolvedRef = useMemo(() => {
    if (referenceId === null) return undefined
    if (referenceId) return referenceId
    return kindHasReference(kind) ? generateReferenceId() : undefined
  }, [kind, referenceId])

  const links = { ...DEFAULT_HREFS, ...hrefs }

  const actionNodes = actionList.map((action, i) => {
    const label = labels[action]
    const primary = i === 0

    if (NAV_ACTIONS.has(action)) {
      const href = links[action as 'home' | 'signIn' | 'search']
      // Anchor-as-button: navigations are real links (work without JS, right
      // click, etc.) styled with the shared button recipe. A caller may
      // intercept for client-side routing via onAction.
      return (
        <a
          key={action}
          href={href}
          className={buttonVariants({
            variant: primary ? 'primary' : 'secondary',
          })}
          onClick={
            onAction
              ? (e) => {
                  // Leave modified clicks (new tab/window) to the browser.
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                  e.preventDefault()
                  onAction(action)
                }
              : undefined
          }
        >
          {label}
        </a>
      )
    }

    // retry / back — real buttons.
    return (
      <Button
        key={action}
        variant={primary ? 'primary' : 'secondary'}
        onClick={() => onAction?.(action)}
      >
        {label}
      </Button>
    )
  })

  const block = (
    <StateBlock
      variant={variant}
      title={
        <>
          <span className="sr-only">
            {a11y.errorPage} {copy.code}.{' '}
          </span>
          {copy.title}
        </>
      }
      description={copy.description}
      referenceId={resolvedRef}
      action={<>{actionNodes}</>}
      headingLevel={headingLevel}
      className={layout === 'inline' ? className : undefined}
    />
  )

  if (layout === 'bare') {
    return (
      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'flex min-h-screen items-center justify-center bg-bg px-4 py-12',
          className,
        )}
      >
        <div className="w-full max-w-md">{block}</div>
      </main>
    )
  }

  return block
}
