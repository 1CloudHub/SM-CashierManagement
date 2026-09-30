import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * BrandMark — the LaneWise logo (task 22, SG-004, design.md "Brand mark").
 *
 * The LaneWise v0.5 concept: a square tile holding three checkout lanes of
 * rising height on a shared floor line, beside the "LaneWise" wordmark and the
 * "by SM Retail" endorsement. Square corners, no gradients, no shadows.
 *
 * Colour comes only from the brand roles (--lw-brand / --lw-on-brand /
 * --lw-brand-endorsement / --lw-appbar / --lw-on-appbar via fill-* utilities),
 * so the mark follows light/dark mode and an SM re-brand without edits here.
 *
 *   variant="default"   on page/surface backgrounds: brand tile, on-brand
 *                       lanes, brand wordmark, muted endorsement.
 *   variant="reversed"  on the primary app bar (--lw-appbar): the tile and all
 *                       text flip to on-appbar and the lanes take the bar colour.
 *   lockup="full"       mark + wordmark + endorsement (default).
 *   lockup="mark"       the square tile alone (nav rail, favicon-size uses;
 *                       legible at 16px).
 *
 * Size it with a height utility (default h-9, 36px as in the wireframes); the
 * SVG scales from its viewBox, so the numbers below are geometry in viewBox
 * units, not px font sizes. The name and endorsement come from the i18n
 * bundles; the whole lockup is one role="img" with that accessible name.
 *
 * Q8/Q28: this is the concept mark pending SM brand + legal sign-off. To swap
 * it, replace the geometry in <LaneTile> and the wordmark block (see SG-004
 * "Swapping the brand"); keep the variant/lockup API so call sites don't move.
 */
export type BrandMarkVariant = 'default' | 'reversed'
export type BrandMarkLockup = 'full' | 'mark'

const TILE = 64
const FULL_WIDTH = 250

/** The three-lane tile, drawn in a 64×64 box. */
function LaneTile({ tile, lanes }: { tile: string; lanes: string }) {
  return (
    <g>
      <rect width={TILE} height={TILE} className={tile} />
      <rect x={16} y={30} width={8} height={18} className={lanes} />
      <rect x={28} y={22} width={8} height={26} className={lanes} />
      <rect x={40} y={14} width={8} height={34} className={lanes} />
      {/* The shared floor line cuts through the lanes in the tile colour. */}
      <rect x={12} y={36} width={40} height={2} className={tile} />
    </g>
  )
}

export function BrandMark({
  variant = 'default',
  lockup = 'full',
  className,
}: {
  variant?: BrandMarkVariant
  lockup?: BrandMarkLockup
  className?: string
}) {
  const { t } = useI18n()
  const name = t('auth.brand.name')
  const endorsement = t('auth.brand.byline')
  const reversed = variant === 'reversed'

  const tile = reversed ? 'fill-on-appbar' : 'fill-brand'
  const lanes = reversed ? 'fill-appbar' : 'fill-on-brand'
  const word = reversed ? 'fill-on-appbar' : 'fill-brand'
  const byline = reversed ? 'fill-on-appbar' : 'fill-brand-endorsement'

  const width = lockup === 'mark' ? TILE : FULL_WIDTH

  return (
    <svg
      viewBox={`0 0 ${width} ${TILE}`}
      role="img"
      aria-label={lockup === 'mark' ? name : `${name} ${endorsement}`}
      data-variant={variant}
      data-lockup={lockup}
      className={cn('block h-9 w-auto shrink-0 font-sans', className)}
    >
      <LaneTile tile={tile} lanes={lanes} />
      {lockup === 'full' && (
        <g aria-hidden="true">
          <text
            x={80}
            y={36}
            fontSize={29}
            fontWeight={700}
            letterSpacing={-1}
            className={word}
          >
            {name}
          </text>
          <text x={81} y={54} fontSize={12} className={byline}>
            {endorsement}
          </text>
        </g>
      )}
    </svg>
  )
}
