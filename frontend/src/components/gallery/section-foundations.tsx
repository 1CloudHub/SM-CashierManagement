import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Subsection, Swatch, SpecRow } from './gallery-parts'

/**
 * Foundations — the design-token reference (task 1.10; tokens from 1.1/1.2,
 * SG-002/004/005/007).
 *
 * Documents the SEMANTIC tokens components consume (never the raw ramps): the
 * colour roles with their accessible on-colours, the type scale, the spacing
 * scale, the shape rules (square corners, 2px outlines, no shadows) and the
 * motion durations/easings. Everything here renders through the same
 * token-bound Tailwind utilities the real components use, so the swatches
 * stay truthful and dark mode is a value swap (SG-009) with no change here.
 */
export function FoundationsSection() {
  return (
    <Stack gap={8}>
      <Subsection
        title="Colour — semantic roles"
        hint="Components read these roles, never the raw ramps. Every fill has a matching on-colour verified for AA contrast (SG-004). Dark mode swaps the values only."
      >
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4 laptop:grid-cols-6">
          <Swatch token="bg-bg" />
          <Swatch token="bg-surface" />
          <Swatch token="bg-surface-2" />
          <Swatch token="bg-primary" onToken="text-on-primary" />
          <Swatch token="bg-primary-soft" onToken="text-on-primary-soft" />
          <Swatch token="bg-accent" onToken="text-on-accent" />
          <Swatch token="bg-success" onToken="text-on-success" />
          <Swatch token="bg-warning" onToken="text-on-warning" />
          <Swatch token="bg-danger" onToken="text-on-danger" />
          <Swatch token="bg-info" onToken="text-on-info" />
          <Swatch token="bg-success-soft" onToken="text-on-success-soft" />
          <Swatch token="bg-warning-soft" onToken="text-on-warning-soft" />
          <Swatch token="bg-danger-soft" onToken="text-on-danger-soft" />
          <Swatch token="bg-info-soft" onToken="text-on-info-soft" />
          <Swatch token="bg-text" onToken="text-bg" />
          <Swatch token="bg-text-muted" onToken="text-bg" />
        </div>
        <p className="text-body-sm text-text-muted">
          Accent red is emphasis only — never a status. Status is always text +
          icon + colour, never colour alone.
        </p>
      </Subsection>

      <Subsection
        title="Colour — data visualisation"
        hint="A separate, colour-blind-safe categorical palette (SG-010, Okabe–Ito). Always paired with a label and a marker; kept apart from the status colours."
      >
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-3 laptop:grid-cols-6">
          <Swatch token="bg-viz-1" onToken="text-bg" sample="1" />
          <Swatch token="bg-viz-2" onToken="text-bg" sample="2" />
          <Swatch token="bg-viz-3" onToken="text-bg" sample="3" />
          <Swatch token="bg-viz-4" onToken="text-bg" sample="4" />
          <Swatch token="bg-viz-5" onToken="text-bg" sample="5" />
          <Swatch token="bg-viz-6" onToken="text-bg" sample="6" />
        </div>
      </Subsection>

      <Subsection
        title="Type scale"
        hint="Size / line-height / weight / tracking are separate tokens, applied via the text-* utilities. Components never hardcode px font sizes (SG-002)."
      >
        <Stack gap={2}>
          <p className="text-display text-text">Display — 32/40</p>
          <p className="text-h1 text-text">Heading 1 — 24/32</p>
          <p className="text-h2 text-text">Heading 2 — 18/26</p>
          <p className="text-h3 text-text">Heading 3 — 16/24</p>
          <p className="text-body text-text">
            Body — 14/22. The default reading size for prose and controls.
          </p>
          <p className="text-body-sm text-text-muted">
            Body small — 13/20. Hints, captions on controls, secondary detail.
          </p>
          <p className="text-label uppercase text-text-muted">
            Label — 12, letterspaced, for eyebrow labels
          </p>
          <p className="text-caption text-text-muted">
            Caption — 11. The smallest supporting text.
          </p>
          <p className="lw-numeric text-kpi text-text">₱13,600,000</p>
          <p className="text-body-sm text-text-muted">
            KPI — 32, bold, tabular figures (lw-numeric) so ₱ columns align.
          </p>
        </Stack>
      </Subsection>

      <Subsection
        title="Spacing scale"
        hint="One scale drives margins, gutters, stack gaps and padding (SG-005). Layout primitives only take these keys — no ad-hoc px."
      >
        <div className="flex flex-wrap items-end gap-4">
          {[
            ['1', 'w-1'],
            ['2', 'w-2'],
            ['3', 'w-3'],
            ['4', 'w-4'],
            ['6', 'w-6'],
            ['8', 'w-8'],
            ['12', 'w-12'],
          ].map(([key, w]) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <div className={`${w} h-8 bg-primary`} />
              <code className="text-caption text-text-muted">{key}</code>
            </div>
          ))}
        </div>
      </Subsection>

      <Subsection
        title="Shape and elevation"
        hint="Square corners, 2px functional outlines (never hairlines), no shadows — elevation is surface stepping. Pills/avatars are the one rounded exception (SG-003)."
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid size-16 place-items-center border-2 border-outline bg-surface text-body-sm text-text-muted">
            0px
          </div>
          <div className="grid size-16 place-items-center rounded-full border-2 border-outline bg-surface text-body-sm text-text-muted">
            pill
          </div>
          <div className="grid h-16 place-items-center bg-bg px-4 text-body-sm text-text-muted">
            bg
          </div>
          <div className="grid h-16 place-items-center bg-surface px-4 text-body-sm text-text-muted">
            surface
          </div>
          <div className="grid h-16 place-items-center bg-surface-2 px-4 text-body-sm text-text-muted">
            surface-2
          </div>
        </div>
      </Subsection>

      <Subsection
        title="Motion — durations and easings"
        hint="Named tokens (SG-007). Components reference these, never raw ms or beziers. prefers-reduced-motion drops movement to no-motion; nothing conveys meaning by motion alone."
      >
        <div className="border-2 border-outline-subtle bg-surface px-4">
          <SpecRow name="--lw-dur-fast" value="120ms — hover, press, exits" />
          <SpecRow name="--lw-dur-base" value="200ms — dialog/toast enter, snap" />
          <SpecRow name="--lw-dur-slow" value="320ms — panels, drawers, theme" />
          <SpecRow name="--lw-dur-shimmer" value="1500ms — skeleton loop" />
          <SpecRow name="--lw-ease-standard" value="on-screen movement" />
          <SpecRow name="--lw-ease-enter" value="arriving (decelerate)" />
          <SpecRow name="--lw-ease-exit" value="leaving (accelerate)" />
        </div>
      </Subsection>
    </Stack>
  )
}

/** Wrapper that renders the section landmark with its gallery-nav heading. */
export function FoundationsGallerySection({
  description,
}: {
  description: string
}) {
  return (
    <Section id="foundations" title="Foundations" description={description}>
      <FoundationsSection />
    </Section>
  )
}
