import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Cluster } from '@/components/layout/cluster'
import { Grid, Col } from '@/components/layout/grid'
import { Sidebar } from '@/components/layout/split'
import { Button, Pill } from '@/components/ui'
import { Subsection } from './gallery-parts'

/**
 * Layout — the grid + layout primitives reference (task 1.10; primitives from
 * task 1.6, SG-005).
 *
 * Screens compose these instead of writing bespoke layout CSS. Each specimen
 * uses a tinted block so the structure (columns, gaps, tracks) reads at a
 * glance. Gutters and gaps come from the spacing scale; the grid steps
 * 4 → 8 → 12 columns at the design breakpoints.
 */

function DemoBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-12 place-items-center bg-primary-soft px-3 py-2 text-body-sm text-on-primary-soft">
      {children}
    </div>
  )
}

export function LayoutSection() {
  return (
    <Stack gap={8}>
      <Subsection
        title="Grid / Col"
        hint="The responsive 12/8/4 column grid with a token gutter. Cols span against each breakpoint's column count. Resize the window to see it reflow."
      >
        <Grid>
          <Col span={4} spanTablet={4} spanLaptop={8}>
            <DemoBlock>span 4 · tablet 4 · laptop 8</DemoBlock>
          </Col>
          <Col span={4} spanTablet={4} spanLaptop={4}>
            <DemoBlock>span 4 · tablet 4 · laptop 4</DemoBlock>
          </Col>
          <Col span={2} spanTablet={4} spanLaptop={6}>
            <DemoBlock>half</DemoBlock>
          </Col>
          <Col span={2} spanTablet={4} spanLaptop={6}>
            <DemoBlock>half</DemoBlock>
          </Col>
        </Grid>
      </Subsection>

      <Subsection
        title="Stack"
        hint="Vertical rhythm from the spacing scale — no ad-hoc margins. Polymorphic (as='ul','section', …)."
      >
        <Stack gap={2}>
          <DemoBlock>Stacked item</DemoBlock>
          <DemoBlock>Stacked item</DemoBlock>
          <DemoBlock>Stacked item</DemoBlock>
        </Stack>
      </Subsection>

      <Subsection
        title="Cluster"
        hint="Horizontal groups that wrap: toolbars, filter chips, button rows. Degrades gracefully on narrow widths instead of overflowing."
      >
        <Cluster>
          <Button variant="secondary">All stores</Button>
          <Pill tone="info">Christmas 2026</Pill>
          <Pill tone="neutral">QC Main</Pill>
          <Pill tone="neutral">Peak hours</Pill>
          <Button variant="ghost" size="sm">
            Clear
          </Button>
        </Cluster>
      </Subsection>

      <Subsection
        title="Split / Sidebar"
        hint="Content plus a docked side track (settings drawer, detail panel, filters). Docks beside content from desktop up; stacks below (rendered as an overlay drawer there)."
      >
        <Sidebar
          sideLabel="Scenario settings"
          side={
            <div className="border border-outline bg-surface-2 p-4">
              <p className="text-label uppercase text-text-muted">
                Settings
              </p>
              <p className="mt-2 text-body-sm text-text-muted">
                Docked side track (desktop+).
              </p>
            </div>
          }
        >
          <div className="border border-outline bg-surface p-4">
            <p className="text-body text-text-muted">
              Main content track. On tablet and mobile the side track moves
              below (or into an overlay drawer).
            </p>
          </div>
        </Sidebar>
      </Subsection>

      <Subsection
        title="Section"
        hint="A labelled card region rendered as a <section> landmark wired to its heading — the same primitive framing every block on this page."
      >
        <Section
          title="Recent activity"
          description="A titled block with optional actions and card chrome."
          actions={
            <Button size="sm" variant="ghost">
              View all
            </Button>
          }
        >
          <p className="text-body text-text-muted">
            Section body. Use <code>bare</code> to drop the card chrome when only
            the labelled grouping is needed.
          </p>
        </Section>
      </Subsection>
    </Stack>
  )
}

export function LayoutGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="layout" title="Layout" description={description}>
      <LayoutSection />
    </Section>
  )
}
