import { ErrorPage, type ErrorPageProps } from './error-page'

/**
 * Named error/status pages (SCR-090).
 *
 * Thin wrappers over `ErrorPage` so routers and error boundaries can mount an
 * intent directly — `<NotFoundPage />`, `<NoAccessPage />` — without repeating
 * the kind string. They forward every prop (locale, referenceId, hrefs,
 * onAction, layout, …). 401 defaults to the `bare` layout since it renders
 * pre-auth, outside the app shell.
 */
type PageProps = Omit<ErrorPageProps, 'kind'>

export function BadRequestPage(props: PageProps) {
  return <ErrorPage kind="400" {...props} />
}

export function NotSignedInPage({ layout, ...props }: PageProps) {
  return <ErrorPage kind="401" layout={layout ?? 'bare'} {...props} />
}

export function NoAccessPage(props: PageProps) {
  return <ErrorPage kind="403" {...props} />
}

export function NotFoundPage(props: PageProps) {
  return <ErrorPage kind="404" {...props} />
}

export function TooManyRequestsPage(props: PageProps) {
  return <ErrorPage kind="429" {...props} />
}

export function ServerErrorPage(props: PageProps) {
  return <ErrorPage kind="500" {...props} />
}

export function ServiceUnavailablePage(props: PageProps) {
  return <ErrorPage kind="503" {...props} />
}

export function OfflinePage(props: PageProps) {
  return <ErrorPage kind="offline" {...props} />
}
