import {
  Button,
  Currency,
  Num,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
} from '@/components/ui'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Cluster } from '@/components/layout/cluster'
import { useAnnouncer, cellActionLabel } from '@/components/a11y'
import { LanguageSwitcher, useI18n } from '@/i18n'
import { HelpButton, InfoPopover, ShortcutReference, Kbd } from '@/components/help'
import { useShortcut } from '@/lib/keyboard'
import { Subsection } from './gallery-parts'

/**
 * Patterns — the cross-cutting layers reference (task 1.10; a11y task 1.7,
 * i18n task 1.8, keyboard + help task 1.9).
 *
 * Exercises the layers screens rely on rather than re-implement: live-region
 * announcements and descriptive labelling (UX-004), the language switcher and
 * locale-aware ₱/number formatting (SG-002), and the keyboard scheme surfaced
 * through the live shortcut reference (SCR-091).
 */
export function PatternsSection() {
  const { t } = useI18n()
  const { announce } = useAnnouncer()

  // A per-section (context) shortcut — registered only while this section is
  // mounted, so it appears in the live reference below and disappears when the
  // gallery unmounts. Demonstrates the registration API + discoverability.
  useShortcut({
    id: 'gallery.selectAllRow',
    keys: ['r'],
    groupId: 'shortcut.group.roster',
    descriptionId: 'shortcut.roster.selectAll',
    run: () => announce(t('state.success.saved'), 'polite'),
  })

  return (
    <Stack gap={8}>
      <Subsection
        title="Accessibility — live regions"
        hint="Async results are announced to assistive tech through the shared announcer (polite for confirmations, assertive for errors)."
      >
        <Cluster>
          <Button onClick={() => announce(t('state.success.saved'), 'polite')}>
            Announce “{t('state.success.saved')}” (polite)
          </Button>
          <Button
            variant="danger"
            onClick={() => announce(t('state.error.title'), 'assertive')}
          >
            Announce error (assertive)
          </Button>
        </Cluster>
      </Subsection>

      <Subsection
        title="Accessibility — descriptive cell actions"
        hint="Dense grid actions get a full accessible name via cellActionLabel — 'Mark unavailable, PT-02, Sat Dec 19' — not just an icon (UX-004)."
      >
        <Cluster>
          <Button
            size="icon"
            variant="ghost"
            aria-label={cellActionLabel(
              'Mark unavailable',
              'PT-02',
              'Sat Dec 19',
            )}
          >
            <span aria-hidden="true">✕</span>
          </Button>
          <code className="text-body-sm text-text-muted">
            {cellActionLabel('Mark unavailable', 'PT-02', 'Sat Dec 19')}
          </code>
        </Cluster>
      </Subsection>

      <Subsection
        title="Internationalisation — language switcher"
        hint="English and Filipino bundles; the switcher persists the choice. Every string on this page resolves through t() (task 1.8)."
      >
        <LanguageSwitcher />
      </Subsection>

      <Subsection
        title="Currency and numbers"
        hint="₱ is the Unicode peso sign (U+20B1) rendered with tabular figures via the shared Currency/Num component, right-aligned so columns align (SG-002)."
      >
        <TableWrap>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Store</TableHeaderCell>
                <TableHeaderCell numeric>Cashiers</TableHeaderCell>
                <TableHeaderCell numeric>Coverage</TableHeaderCell>
                <TableHeaderCell numeric>Season cost</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableRowHeader>QC Main</TableRowHeader>
                <TableCell numeric>
                  <Num value={254} />
                </TableCell>
                <TableCell numeric>
                  <Num value={0.92} percent />
                </TableCell>
                <TableCell numeric>
                  <Currency value={3_688_400} />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableRowHeader>Makati</TableRowHeader>
                <TableCell numeric>
                  <Num value={88} />
                </TableCell>
                <TableCell numeric>
                  <Num value={0.87} percent />
                </TableCell>
                <TableCell numeric>
                  <Currency value={1_240_000} />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableWrap>
      </Subsection>

      <Subsection
        title="Field-level help"
        hint="Essential info is a real, keyboard- and screen-reader-accessible popover — never a hover tooltip alone (UX-004)."
      >
        <Cluster>
          <span className="text-body text-text">Shrinkage uplift</span>
          <InfoPopover title="Shrinkage uplift">
            Adds an allowance for breaks, training and absence on top of the
            Erlang C requirement (DOM-001).
          </InfoPopover>
        </Cluster>
      </Subsection>

      <Subsection
        title="Keyboard shortcuts"
        hint="The global scheme plus any context shortcuts registered by the current screen. This list is live — the roster shortcut below is registered by this section (press ? anywhere to open the full reference)."
      >
        <Cluster>
          <HelpButton showLabel />
          <span className="inline-flex items-center gap-1 text-body-sm text-text-muted">
            Open the reference with <Kbd>?</Kbd>
          </span>
        </Cluster>
        <ShortcutReference />
      </Subsection>
    </Stack>
  )
}

export function PatternsGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="patterns" title="Patterns" description={description}>
      <PatternsSection />
    </Section>
  )
}
