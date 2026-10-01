import { useMemo } from 'react'
import { useI18n } from '@/i18n'
import { useKeyboardShortcuts, type Shortcut } from '@/lib/keyboard'
import { StateBlock } from '@/components/ui/state-block'
import { Stack } from '@/components/layout/stack'
import { ShortcutKeys } from './kbd'

/**
 * Shortcut reference (task 1.9, SCR-091).
 *
 * Renders every currently-registered shortcut, grouped by its `groupId`, with a
 * localised description and its key chips. It reads the live registry from the
 * keyboard engine, so context shortcuts (e.g. the roster timeline) appear only
 * while that screen is mounted, and nothing is listed that cannot actually be
 * pressed — satisfying "all discoverable" and "all listed in the reference".
 *
 * Groups are ordered by first appearance; within a group, shortcuts keep their
 * registration order (global scheme first, since the app root registers it
 * before any screen). If no shortcuts are registered the empty state explains
 * that the global scheme still applies.
 *
 * As a description list (<dl>), each row pairs the action (the accessible
 * source of truth) with its keys, so screen-reader users hear "Search — ⌘ K".
 */
export function ShortcutReference() {
  const { t } = useI18n()
  const { shortcuts } = useKeyboardShortcuts()

  const groups = useMemo(() => groupShortcuts(shortcuts), [shortcuts])

  if (groups.length === 0) {
    return (
      <StateBlock
        variant="empty"
        title={t('help.empty.title')}
        description={t('help.empty.description')}
      />
    )
  }

  return (
    <Stack gap={6} as="section" aria-label={t('help.shortcutsHeading')}>
      {groups.map((group) => (
        <div key={group.groupId}>
          <h3 className="mb-2 text-h3 text-text">{t(group.groupId)}</h3>
          <dl className="flex flex-col">
            {group.items.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 border-b border-outline-subtle py-2 last:border-b-0"
              >
                <dt className="text-body text-text">{t(s.descriptionId)}</dt>
                <dd className="shrink-0">
                  <ShortcutKeys shortcut={s} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </Stack>
  )
}

interface ShortcutGroup {
  groupId: string
  items: Shortcut[]
}

/** Group by groupId, preserving first-seen group order and item order. */
function groupShortcuts(shortcuts: Shortcut[]): ShortcutGroup[] {
  const order: string[] = []
  const map = new Map<string, Shortcut[]>()
  for (const s of shortcuts) {
    if (!s.keys && !s.sequence) continue
    if (!map.has(s.groupId)) {
      map.set(s.groupId, [])
      order.push(s.groupId)
    }
    map.get(s.groupId)!.push(s)
  }
  return order.map((groupId) => ({ groupId, items: map.get(groupId)! }))
}
