import type { CSSProperties } from 'react'
import type {
  ColourBy,
  ContractType,
  RosterCashier,
  RosterDepartment,
  VizIndex,
} from './types'

/**
 * Category colours for the roster (requirement 6.3/6.4). A category sets the
 * `--cat` custom property to a data-viz token; roster.css paints fills and
 * bands from it. Every category also carries a letter and a name, so colour is
 * never the only channel.
 */
export function catStyle(viz: VizIndex): CSSProperties {
  return { '--cat': `var(--lw-viz-${viz})` } as CSSProperties
}

/** Palette slots for contract colouring (distinct from department slots). */
export const CONTRACT_VIZ: Record<ContractType, VizIndex> = {
  fullTime: 1,
  partTime: 3,
  float: 5,
  borrowed: 2,
}

export interface Category {
  readonly viz: VizIndex
  readonly letter: string
  readonly name: string
}

/**
 * Resolve the colour band for a chip under the active "Colour by" choice.
 * `t` provides the localised letter + name for contract and home-store modes.
 */
export function chipCategory(
  colourBy: ColourBy,
  cashier: RosterCashier,
  department: RosterDepartment | undefined,
  t: (id: string) => string,
): Category {
  if (colourBy === 'contract') {
    return {
      viz: CONTRACT_VIZ[cashier.contract],
      letter: t(`roster.contract.letter.${cashier.contract}`),
      name: t(`roster.contract.${cashier.contract}`),
    }
  }
  if (colourBy === 'homeStore') {
    const borrowed = Boolean(cashier.homeStore)
    return {
      viz: borrowed ? 2 : 1,
      letter: t(borrowed ? 'roster.homeStore.letter.borrowed' : 'roster.homeStore.letter.home'),
      name: t(borrowed ? 'roster.homeStore.borrowed' : 'roster.homeStore.home'),
    }
  }
  return {
    viz: department?.viz ?? 5,
    letter: department?.letter ?? '?',
    name: department?.name ?? '',
  }
}
