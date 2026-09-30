import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useApi } from '@/api'
import { useActiveRole } from '@/app/active-role'
import { AppLayout } from '@/app/app-layout'
import { useRouter } from '@/app/router'
import { useScreenCrumbs } from '@/app/screen-crumbs'
import { SCREEN_BY_ID } from '@/app/screens'
import { Stack } from '@/components/layout'
import { CardSkeleton, StateBlock } from '@/components/ui'
import { useI18n } from '@/i18n'
import { RulesApiError, createRulesClient, type RulesClient } from './api'
import { defaultVersion, editorPath } from './logic'
import { RuleSetsScreen } from './rule-sets-screen'
import { RuleVersionEditorScreen } from './rule-version-editor-screen'

/**
 * Route pages for the task 8.2 route table: SCR-060 at `/rules` and SCR-061
 * at `/rules/:ruleSetId/edit` (`?version=<id>` picks a version; without it
 * the set's open version, else its latest). The rules client rides on the
 * app's API client, so every request carries the active role (task 8.1).
 */

const SCR_060 = SCREEN_BY_ID['SCR-060']
const SCR_061 = SCREEN_BY_ID['SCR-061']

function useRulesClient(): RulesClient {
  const api = useApi()
  return useMemo(() => createRulesClient(api), [api])
}

export function RuleSetsPage() {
  const { t } = useI18n()
  const client = useRulesClient()
  const { role } = useActiveRole()
  const { navigate } = useRouter()
  const crumbs = useScreenCrumbs(SCR_060)
  return (
    <AppLayout title={t(SCR_060.titleKey)} crumbs={crumbs}>
      <RuleSetsScreen
        client={client}
        role={role}
        onOpenVersion={(versionId, ruleSetId) => navigate(editorPath(ruleSetId, versionId))}
      />
    </AppLayout>
  )
}

type Resolve =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly referenceId?: string }
  | { readonly kind: 'ready'; readonly versionId: string }

export function RuleVersionEditorPage() {
  const { t } = useI18n()
  const client = useRulesClient()
  const { role } = useActiveRole()
  const { location, navigate } = useRouter()
  const { ruleSetId = '' } = useParams()
  const crumbs = useScreenCrumbs(SCR_061)
  const requested = new URLSearchParams(location.search).get('version')
  const [resolved, setResolved] = useState<Resolve>({ kind: 'loading' })

  useEffect(() => {
    if (requested) return
    let live = true
    client.listVersions(ruleSetId).then(
      ({ versions }) => {
        if (!live) return
        const v = defaultVersion(versions)
        setResolved(v ? { kind: 'ready', versionId: v.id } : { kind: 'error' })
      },
      (error: unknown) => {
        if (live) setResolved({ kind: 'error', referenceId: error instanceof RulesApiError ? (error.requestId ?? undefined) : undefined })
      },
    )
    return () => {
      live = false
    }
  }, [client, ruleSetId, requested])

  const versionId = requested ?? (resolved.kind === 'ready' ? resolved.versionId : null)
  const title = t(SCR_061.titleKey)
  return (
    <AppLayout title={title} crumbs={crumbs}>
      {versionId ? (
        <RuleVersionEditorScreen client={client} role={role} versionId={versionId} onBack={() => navigate(SCR_060.path)} />
      ) : (
        <Stack gap={4}>
          <h1 className="text-h1 text-text">{title}</h1>
          {resolved.kind === 'error' ? (
            <StateBlock variant="error" title={t('rules.editor.error.title')} referenceId={resolved.referenceId} />
          ) : (
            <CardSkeleton label={t('state.loading')} />
          )}
        </Stack>
      )}
    </AppLayout>
  )
}
