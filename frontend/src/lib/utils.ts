import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Tailwind-merge, taught about the LaneWise token utilities.
 *
 * Our type scale exposes custom font-size utilities (text-display/h1/h2/h3/
 * body/body-sm/label/caption/kpi) and our colours expose custom text-* colour
 * utilities (text-text, text-text-muted, text-primary, ...). Both live under
 * the `text-` prefix, so the default tailwind-merge would treat `text-body`
 * (size) and `text-text` (colour) as conflicting and drop one. We extend the
 * two groups so our size + colour utilities join the right group and only
 * same-group classes de-duplicate. (Our motion utilities `duration-fast/base/
 * slow` already share the built-in `duration` group, so they need no config.)
 */
const FONT_SIZES = [
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'body-sm',
  'label',
  'caption',
  'kpi',
]

const TEXT_COLORS = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'primary',
  'on-primary',
  'primary-soft',
  'on-primary-soft',
  'accent',
  'on-accent',
  'success',
  'on-success',
  'on-success-soft',
  'warning',
  'on-warning',
  'on-warning-soft',
  'danger',
  'on-danger',
  'on-danger-soft',
  'info',
  'on-info',
  'on-info-soft',
  'outline',
  'outline-subtle',
]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
      'text-color': [{ text: TEXT_COLORS }],
    },
  },
})

/**
 * Merge Tailwind class names, de-duplicating conflicting utilities.
 * Used by every component (ADR-0003).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
