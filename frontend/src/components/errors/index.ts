/**
 * Error and status pages (SCR-090).
 *
 * `ErrorPage` is the single component; the named pages in `./pages` are thin,
 * self-documenting wrappers so routers/error boundaries can mount an intent
 * directly (`<NotFoundPage />`) without repeating the kind string. All copy is
 * localised via the placeholder string map in `./messages` (task 1.8 swaps in
 * the real en/fil bundles behind the same lookup).
 */
export { ErrorPage, type ErrorPageProps } from './error-page'
export {
  resolveActionLabels,
  resolveAnnouncements,
  resolveErrorCopy,
  type ErrorCopy,
  type ErrorKind,
  type Locale,
  type RecoveryAction,
} from './messages'
export { generateReferenceId, kindHasReference } from './reference-id'
export {
  BadRequestPage,
  NoAccessPage,
  NotFoundPage,
  NotSignedInPage,
  OfflinePage,
  ServerErrorPage,
  ServiceUnavailablePage,
  TooManyRequestsPage,
} from './pages'
