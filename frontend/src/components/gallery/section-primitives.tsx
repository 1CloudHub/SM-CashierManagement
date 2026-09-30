import { useState } from 'react'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  Currency,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  KpiCard,
  Num,
  Pill,
  SegmentedControl,
  SegmentedItem,
  Select,
  SortHeader,
  Spinner,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TableRowHeader,
  TableWrap,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  useToast,
  type SortDirection,
} from '@/components/ui'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Grid, Col } from '@/components/layout/grid'
import { useI18n } from '@/i18n'
import { InfoPopover } from '@/components/help'
import { Subsection, Specimen } from './gallery-parts'

/**
 * Primitives — the UI component reference (task 1.10; components from 1.4,
 * SG-001/006, UX-004/010).
 *
 * Documents each atomic and composite component the screens compose, with its
 * variants and accessible behaviour visible. All product copy (button verbs,
 * status words) still flows through the i18n bundles (task 1.8); the specimen
 * captions are style-guide scaffolding.
 */
export function PrimitivesSection() {
  const { t } = useI18n()
  const { toast } = useToast()
  const [sort, setSort] = useState<SortDirection>('asc')

  return (
    <Stack gap={8}>
      <Subsection
        title="Buttons"
        hint="Solid fill is reserved for the single primary action; everything else is outline or ghost. Danger is for destructive confirms. Every size keeps a ≥44px touch target."
      >
        <Specimen name="variant: primary · secondary · ghost · danger">
          <Button variant="primary">{t('action.sendOffers')}</Button>
          <Button variant="secondary">{t('action.recalculate')}</Button>
          <Button variant="ghost">{t('action.cancel')}</Button>
          <Button variant="danger">{t('action.archiveScenario')}</Button>
        </Specimen>
        <Specimen name="size: md · sm · icon · loading (aria-busy) · disabled">
          <Button size="md">{t('action.save')}</Button>
          <Button size="sm">{t('action.edit')}</Button>
          <Button size="icon" aria-label={t('action.search')}>
            <span aria-hidden="true">⌕</span>
          </Button>
          <Button variant="primary" loading>
            {t('action.publishPlan')}
          </Button>
          <Button disabled>{t('action.confirm')}</Button>
        </Specimen>
      </Subsection>

      <Subsection
        title="Pills and status"
        hint="Status is always text + icon + colour, never colour alone (StatusPill). Solid fill marks the single most urgent item. Accent red is not a status."
      >
        <Specimen name="StatusPill: success (solid) · warning · danger · info; Pill: neutral">
          <StatusPill tone="success" fill="solid">
            Published
          </StatusPill>
          <StatusPill tone="warning">Stale</StatusPill>
          <StatusPill tone="danger">Short</StatusPill>
          <StatusPill tone="info">Submitted</StatusPill>
          <Pill tone="neutral">Draft</Pill>
        </Specimen>
      </Subsection>

      <Subsection
        title="KPI cards"
        hint="A headline number with a label and detail. emphasis='key' marks the one key number per screen with a solid fill; tone adds a paired status icon."
      >
        <Grid>
          <Col span={2} spanTablet={4} spanLaptop={4}>
            <KpiCard
              label="Seasonal hires"
              value={<Num value={284} />}
              detail="176 FT · 108 PT"
              emphasis="key"
            />
          </Col>
          <Col span={2} spanTablet={4} spanLaptop={4}>
            <KpiCard
              label="Season cost"
              value={<Currency value={13_600_000} compact />}
              detail="approved budget"
            />
          </Col>
          <Col span={2} spanTablet={4} spanLaptop={4}>
            <KpiCard
              label="Coverage gap"
              value={<Num value={12} />}
              detail="lanes short at peak"
              tone="danger"
            />
          </Col>
        </Grid>
      </Subsection>

      <Subsection
        title="Cards"
        hint="A surface panel: square corners, 2px outline, no shadow. Compose a header + body."
      >
        <Card>
          <CardHeader>
            <CardTitle>Christmas 2026 v4</CardTitle>
            <StatusPill tone="warning">Stale</StatusPill>
          </CardHeader>
          <p className="text-body text-text-muted">
            Draft scenario. Recalculate to refresh against the latest snapshot
            and rules.
          </p>
        </Card>
      </Subsection>

      <Subsection
        title="Inputs and fields"
        hint="Every control has a label. Field wires the label, hint, error and aria-describedby once; essential help is a real popover, never tooltip-only (UX-004)."
      >
        <div className="grid gap-4 tablet:grid-cols-2">
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                Scenario name
                <InfoPopover title="Scenario name">
                  Shown on the leadership summary and in exports.
                </InfoPopover>
              </span>
            }
            hint="Shown on the leadership summary."
            required
          >
            {(aria) => <Input {...aria} defaultValue="Christmas 2026 v4" />}
          </Field>
          <Field label="Service target">
            {(aria) => (
              <Select {...aria} defaultValue="90-60">
                <option value="90-60">90% answered within 60s</option>
                <option value="85-90">85% answered within 90s</option>
              </Select>
            )}
          </Field>
          <Field label="Change note" error="A change note is required.">
            {(aria) => <Textarea {...aria} />}
          </Field>
        </div>
      </Subsection>

      <Subsection
        title="Tabs and segmented control"
        hint="Radix semantics (roving focus, aria-selected). The active state is fill + aria-selected, cross-faded — never a sliding underline or motion alone."
      >
        <Tabs defaultValue="details">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <p className="text-body text-text-muted">
              Tab panels fade in and are focusable for keyboard users.
            </p>
          </TabsContent>
          <TabsContent value="history">
            <p className="text-body text-text-muted">History panel.</p>
          </TabsContent>
          <TabsContent value="audit">
            <p className="text-body text-text-muted">Audit panel.</p>
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="day">
          <SegmentedControl aria-label="Roster view">
            <SegmentedItem value="day">Day</SegmentedItem>
            <SegmentedItem value="week">Week</SegmentedItem>
            <SegmentedItem value="month">Month</SegmentedItem>
          </SegmentedControl>
          <TabsContent value="day">
            <p className="text-body text-text-muted">Day view.</p>
          </TabsContent>
          <TabsContent value="week">
            <p className="text-body text-text-muted">Week view.</p>
          </TabsContent>
          <TabsContent value="month">
            <p className="text-body text-text-muted">Month view.</p>
          </TabsContent>
        </Tabs>
      </Subsection>

      <Subsection
        title="Dialog"
        hint="Radix Dialog: focus trap, Esc to close, aria-modal, focus returns to the trigger. Destructive confirms name the object and its effect."
      >
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="danger">Archive scenario…</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Archive “Christmas 2026 v4”?</DialogTitle>
              <DialogDescription>
                Archiving removes it from planning lists. You can restore it
                later.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">{t('action.cancel')}</Button>
              </DialogClose>
              <Button variant="danger">{t('action.archiveScenario')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Subsection>

      <Subsection
        title="Toasts"
        hint="Transient confirmations. Success and error tones pair an icon with text; errors announce assertively. They hold, then fade (SG-007)."
      >
        <Specimen name="toast: success · danger">
          <Button
            onClick={() =>
              toast({ title: t('state.success.published'), tone: 'success' })
            }
          >
            Success toast
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              toast({
                title: 'Could not send offers',
                description: 'Try again in a moment.',
                tone: 'danger',
              })
            }
          >
            Error toast
          </Button>
        </Specimen>
      </Subsection>

      <Subsection
        title="Spinner"
        hint="Deferred (appears only after a short wait) so it never flashes. For short waits only — longer, layout-bearing waits use skeletons instead (UX-010)."
      >
        <Specimen name="Spinner (delayMs=0 here so it shows immediately in the reference)">
          <Spinner delayMs={0} label={t('state.loading')} />
        </Specimen>
      </Subsection>

      <Subsection
        title="Table"
        hint="Sortable, sticky header + first column. ₱ figures render through the shared Currency component (tabular, U+20B1). Numeric columns are right-aligned."
      >
        <TableWrap>
          <Table stickyFirstCol>
            <caption className="p-2 text-left text-h3">Recent scenarios</caption>
            <TableHead>
              <TableRow>
                <SortHeader
                  direction={sort}
                  onSort={() => setSort((d) => (d === 'asc' ? 'desc' : 'asc'))}
                >
                  Scenario
                </SortHeader>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Updated</TableHeaderCell>
                <TableHeaderCell numeric>Season cost</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableRowHeader>★ Christmas 2026 v3</TableRowHeader>
                <TableCell>
                  <StatusPill tone="success" fill="solid">
                    Published
                  </StatusPill>
                </TableCell>
                <TableCell>Oct 1</TableCell>
                <TableCell numeric>
                  <Currency value={13_600_000} compact />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableRowHeader>Christmas 2026 v4</TableRowHeader>
                <TableCell>
                  <StatusPill tone="warning">Stale</StatusPill>
                </TableCell>
                <TableCell>Oct 3</TableCell>
                <TableCell numeric>
                  <Currency value={13_100_000} compact />
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableWrap>
      </Subsection>
    </Stack>
  )
}

export function PrimitivesGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="primitives" title="Primitives" description={description}>
      <PrimitivesSection />
    </Section>
  )
}
