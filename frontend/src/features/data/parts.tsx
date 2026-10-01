/**
 * Small presentational parts shared by SCR-050 and SCR-051.
 */
import type { ProvenanceInfo } from '@lanewise/shared'
import { Alert } from '@/components/ui'
import { useI18n } from '@/i18n'
import type { ErrorCopy } from './helpers'

/**
 * The sample-data banner (requirement 18.1): shown while any dataset in use is
 * flagged synthetic. Deliberately has no dismiss control.
 */
export function SampleDataBanner({ provenance }: { provenance: ProvenanceInfo | null }) {
  const { t } = useI18n()
  if (!provenance?.sampleData) return null
  const types = provenance.syntheticDatasetTypes.map((type) => t(`data.type.${type}`)).join(', ')
  return (
    <Alert tone="warning" title={t('sampleData.title')} live={false} data-testid="sample-data-banner">
      {t('sampleData.description')}
      {types && <> {t('data.sampleData.types', { types })}</>}
    </Alert>
  )
}

/** An inline error with its localised message and support reference ID. */
export function ErrorAlert({
  error,
  action,
  id,
  assertive = true,
}: {
  error: ErrorCopy
  action?: React.ReactNode
  id?: string
  assertive?: boolean
}) {
  const { t } = useI18n()
  return (
    <Alert id={id} tone="danger" assertive={assertive} action={action}>
      <p>{error.message}</p>
      {error.requestId && (
        <p className="mt-1">
          {t('a11y.referenceId')}: <span className="lw-numeric font-weight-semibold">{error.requestId}</span>
        </p>
      )}
    </Alert>
  )
}
