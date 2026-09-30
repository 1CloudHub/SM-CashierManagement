/**
 * Data sources and ingestion (task 9 — requirements 17, 18; SCR-050/051).
 *
 *   - DataSourcesScreen   SCR-050: datasets, provenance flag, ingestion history
 *   - UploadScreen        SCR-051: choose → map → validate → confirm and load
 *   - createDataApi       typed client for the ingestion routes (injectable
 *                         fetch, base URL and Cognito ID-token getter)
 *
 *   - DataSourcesPage / UploadPage   the screens inside the app shell,
 *                         wired to the shared API client and active role
 *
 * Routing is owned by the app (src/app/app-routes.tsx).
 */
export { DataSourcesScreen, HISTORY_LIMIT, type DataSourcesScreenProps } from './data-sources-screen'
export { UploadScreen, type UploadScreenProps } from './upload-screen'
export { DataSourcesPage, UploadPage } from './pages'
export {
  ApiRequestError,
  codeForStatus,
  createDataApi,
  dataApiFromClient,
  downloadFile,
  errorFromResponse,
  isApiRequestError,
  type ApiRequestErrorCode,
  type DataApi,
  type DataApiOptions,
  type FetchLike,
  type ListIngestionsQuery,
  type ListSnapshotsQuery,
} from './api'
export {
  autoMapColumns,
  isMappingComplete,
  mappingProblems,
  parseHeaderRow,
  readHeaderRow,
  toColumnMapping,
  type DraftMapping,
  type MappingProblems,
} from './columns'
