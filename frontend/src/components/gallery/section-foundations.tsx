import { BrandMark } from '@/components/brand'
import { Section } from '@/components/layout/section'
import { Stack } from '@/components/layout/stack'
import { Subsection, Swatch, SpecRow } from './gallery-parts'

/**
 * The raw brand ramps (PRIMITIVES). Shown for reference only — components use
 * the semantic roles. Rendered through the --lw-* variables so the gallery
 * tracks tokens.css with no colour value duplicated here.
 */
const RAMPS: readonly { name: string; stops: readonly number[] }[] = [
  { name: 'blue', stops: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: 'red', stops: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  { name: 'slate', stops: [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
]

function Ramp({ name, stops }: { name: string; stops: readonly number[] }) {
  return (
    <div className="flex flex-col gap-1">
      <code className="text-caption text-text-muted">--lw-{name}-*</code>
      <div className="flex border border-outline">
        {stops.map((stop) => (
          <div
            key={stop}
            className="h-10 flex-1"
            style={{ backgroundColor: `var(--lw-${name}-${stop})` }}
            title={`--lw-${name}-${stop}`}
          />
        ))}
      </div>
      <div className="flex">
        {stops.map((stop) => (
          <code key={stop} className="flex-1 text-center text-caption text-text-muted">
            {stop}
          </code>
        ))}
      </div>
    </div>
  )
}

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
        title="Brand — LaneWise by SM Retail"
        hint="The three-lane mark, wordmark and 'by SM Retail' endorsement (concept v0.5, task 22). Coloured only by the brand roles, so it follows dark mode and an SM re-brand. SM brand + legal sign-off is pending (Q8/Q28)."
      >
        <div className="flex flex-wrap items-center gap-6">
          <div className="border border-outline-subtle bg-surface p-4">
            <BrandMark />
          </div>
          <div className="border border-outline-subtle bg-bg p-4">
            <BrandMark />
          </div>
          <div className="flex items-center gap-3 border border-outline-subtle bg-surface p-4">
            <BrandMark lockup="mark" className="h-4" />
            <BrandMark lockup="mark" className="h-6" />
            <BrandMark lockup="mark" className="h-9" />
          </div>
        </div>
        <div className="flex items-center gap-4 bg-appbar pr-4 text-on-appbar">
          <BrandMark variant="reversed" className="m-2" />
          <span className="ml-auto border border-on-appbar px-3 py-1 text-body-sm">
            Reversed on the primary app bar
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 tablet:grid-cols-4">
          <Swatch token="bg-brand" onToken="text-on-brand" />
          <Swatch token="bg-appbar" onToken="text-on-appbar" />
          <Swatch token="bg-brand-endorsement" onToken="text-surface" />
          <Swatch token="bg-focus-ring" onToken="text-surface" sample="" />
        </div>
      </Subsection>

      <Subsection
        title="Colour — brand ramps (primitives)"
        hint="The raw LaneWise ramps that feed every semantic role. Reference only: components never read these. To re-brand, replace these values in tokens.css (SG-004 'Swapping the brand'); the contrast suite re-checks every pair in both themes."
      >
        <Stack gap={3}>
          {RAMPS.map((r) => (
            <Ramp key={r.name} name={r.name} stops={r.stops} />
          ))}
        </Stack>
      </Subsection>

      <Subsection
        title="Colour — semantic roles"
        hint="Components read these roles, never the raw ramps. Every fill has a matching on-colour; tokens.contrast.test.ts fails the build if any pair drops below 4.5:1 (text) or 3:1 (outlines, focus, chart series) in either theme. Dark mode swaps the values only."
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
          <Swatch token="bg-outline" onToken="text-surface" sample="" />
          <Swatch token="bg-outline-subtle" onToken="text-text" sample="" />
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
        hint="Size / line-height / weight / tracking are separate tokens, applied via the text-* utilities. Components never hardcode px font sizes (SG-002). System UI stack with Noto Sans as the fallback for Ñ/ñ and the peso sign (U+20B1)."
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
          <p className="text-body text-text">
            Filipino coverage — Ñ ñ · Mag-iskedyul ng kahera sa Parañaque · ₱
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
          <div className="grid size-16 place-items-center border border-outline bg-surface text-body-sm text-text-muted">
            0px
          </div>
          <div className="grid size-16 place-items-center rounded-full border border-outline bg-surface text-body-sm text-text-muted">
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
        <div className="border border-outline-subtle bg-surface px-4">
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
