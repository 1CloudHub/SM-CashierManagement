import { useId } from 'react'

const TILES = [
  'M0 47V18A18 18 0 0 1 18 0H47V47Z',
  'M53 0H82A18 18 0 0 1 100 18V47H53Z',
  'M0 53H47V100H18A18 18 0 0 1 0 82Z',
  'M53 53H100V82A18 18 0 0 1 82 100H53Z',
]

/** The SM Atrium Courtyard mark: four tiles around an open centre, with the user as the orange dot. */
export function Mark({ size = 24, inverse = false }: { size?: number; inverse?: boolean }) {
  const id = useId()
  const fills = inverse ? ['#4F86D8', '#4FB3E8', '#4AA8B0', '#FFFFFF'] : ['#1C4FA0', '#4FB3E8', '#4AA8B0', '#0B1D74']
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id={id}>
          <rect width="100" height="100" fill="#fff" />
          <circle cx="50" cy="50" r="17" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        {TILES.map((d, i) => (
          <path key={d} d={d} fill={fills[i]} />
        ))}
      </g>
      <circle cx="50" cy="50" r="7" fill="#EE7623" />
    </svg>
  )
}

/** Outline variant used as the command-bar prompt. */
export function OutlineMark({ size = 18 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
      <defs>
        <mask id={id}>
          <rect width="100" height="100" fill="#fff" />
          <circle cx="50" cy="50" r="19" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${id})`} fill="none" stroke="#1C4FA0" strokeWidth="9">
        <path d="M5 44V20A15 15 0 0 1 20 5H44V44Z" />
        <path d="M56 5H80A15 15 0 0 1 95 20V44H56Z" />
        <path d="M5 56H44V95H20A15 15 0 0 1 5 80Z" />
        <path d="M56 56H95V80A15 15 0 0 1 80 95H56Z" />
      </g>
      <circle cx="50" cy="50" r="9" fill="#EE7623" />
    </svg>
  )
}

/** Four separated tiles: the "All apps" drawer icon. */
export function GridMark({ size = 26 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <mask id={id}>
          <rect width="100" height="100" fill="#fff" />
          <circle cx="50" cy="50" r="17" fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        <rect x="2" y="2" width="42" height="42" rx="12" fill="#1C4FA0" />
        <rect x="56" y="2" width="42" height="42" rx="12" fill="#4FB3E8" />
        <rect x="2" y="56" width="42" height="42" rx="12" fill="#4AA8B0" />
        <rect x="56" y="56" width="42" height="42" rx="12" fill="#0B1D74" />
      </g>
      <circle cx="50" cy="50" r="8" fill="#EE7623" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <b>SM</b> <span>ATRIUM</span>
    </span>
  )
}

export function Icon({ d, size = 20, stroke = 'currentColor' }: { d: string; size?: number; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const SPARK = 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'
