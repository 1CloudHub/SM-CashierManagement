import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CardSkeleton,
  CardTitle,
  KpiCardSkeleton,
  MediaPlaceholder,
  StateBlock,
  Table,
  TableBody,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableSkeleton,
  TableWrap,
  useToast,
} from '@/components/ui'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Grid, Col } from '@/components/layout/grid'
import { useI18n } from '@/i18n'
import { Subsection } from './gallery-parts'

/**
 * States — the standard state set (task 1.10; UX-010).
 *
 * Every screen ships this full set so a view is never a blank or a dead end:
 * loading/skeleton, empty, error, no-access, stale, unsaved and success. Copy
 * is sourced from the i18n bundles (task 1.8); skeletons match the final layout
 * to avoid shift and stop animating under reduced motion.
 */
export function StatesSection() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [unsavedOpen, setUnsavedOpen] = useState(false)

  return (
    <Stack gap={8}>
      <Subsection
        title="Loading / skeleton"
        hint="Skeletons mirror the final layout (KPI, card, table) so nothing shifts. Charts/timeline/map use a labelled placeholder that announces the wait."
      >
        <Grid>
          <Col span={2} spanTablet={4} spanLaptop={4}>
            <KpiCardSkeleton label={t('state.loading')} />
          </Col>
          <Col span={4} spanTablet={4} spanLaptop={4}>
            <CardSkeleton label={t('state.loading')} />
          </Col>
          <Col span={4} spanTablet={8} spanLaptop={4}>
            <MediaPlaceholder label={t('state.loading')} />
          </Col>
        </Grid>
        <TableSkeleton columns={4} rows={3} label={t('state.loading')} />
      </Subsection>

      <Subsection
        title="Empty"
        hint="Explains why there is nothing to show and offers the next step (UX-003 microcopy)."
      >
        <StateBlock
          variant="empty"
          title="No published plan for this season yet"
          description="Duplicate a draft and submit it for approval."
          action={
            <Button variant="primary">{t('action.openScenarios')}</Button>
          }
        />
        <TableWrap>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableEmpty colSpan={2}>
                No scenarios match these filters.
              </TableEmpty>
            </TableBody>
          </Table>
        </TableWrap>
      </Subsection>

      <Subsection
        title="Error"
        hint="Says what went wrong and how to recover, with a reference id for support and a retry — no stack traces (UX-010). Announced assertively."
      >
        <StateBlock
          variant="error"
          title={t('state.error.title')}
          description={t('state.error.description')}
          referenceId="LW-4F2A19"
          action={<Button variant="primary">{t('action.retry')}</Button>}
        />
      </Subsection>

      <Subsection
        title="No access"
        hint="Reveals nothing about the out-of-scope object — no partial data — and offers a way back (req. 2)."
      >
        <StateBlock
          variant="no-access"
          title={t('state.noAccess.title')}
          description={t('state.noAccess.description')}
          action={<Button>{t('action.home')}</Button>}
        />
      </Subsection>

      <Subsection
        title="Stale"
        hint="A run whose snapshot or rules have been superseded. The banner offers Recalculate; the state is carried by text + icon, not colour alone."
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('state.stale.title')}</CardTitle>
          </CardHeader>
          <Alert
            tone="info"
            title={t('state.stale.title')}
            action={<Button size="sm">{t('action.recalculate')}</Button>}
          >
            {t('state.stale.description')}
          </Alert>
        </Card>
      </Subsection>

      <Subsection
        title="Unsaved"
        hint="Guards a navigation away from unsaved work. Names the effect and offers discard vs stay (UX-010)."
      >
        <Stack gap={3}>
          <Button variant="secondary" onClick={() => setUnsavedOpen((o) => !o)}>
            {unsavedOpen ? 'Hide' : 'Show'} unsaved warning
          </Button>
          {unsavedOpen && (
            <Alert
              tone="warning"
              title={t('state.unsaved.title')}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost">
                    {t('action.cancel')}
                  </Button>
                  <Button size="sm" variant="danger">
                    {t('action.discard')}
                  </Button>
                </div>
              }
            >
              {t('state.unsaved.description')}
            </Alert>
          )}
        </Stack>
      </Subsection>

      <Subsection
        title="Success"
        hint="A transient confirmation of a completed action (UX-010), announced politely."
      >
        <Stack gap={3}>
          <Alert tone="success" title={t('state.success.published')} live={false}>
            The plan is now the published scenario for this season.
          </Alert>
          <Button
            onClick={() =>
              toast({ title: t('state.success.saved'), tone: 'success' })
            }
          >
            Trigger success toast
          </Button>
        </Stack>
      </Subsection>
    </Stack>
  )
}

export function StatesGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="states" title="States" description={description}>
      <StatesSection />
    </Section>
  )
}
