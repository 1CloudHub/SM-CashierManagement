import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  type LucideIcon,
} from 'lucide-react'

/**
 * Shared status vocabulary (SG-004, UX-010, accessibility rule).
 *
 * Status is NEVER conveyed by colour alone: every status carries text + an
 * icon + a colour. This single source keeps the icon/colour pairing consistent
 * across pills, alerts, banners and toasts so a screen never re-picks them.
 *
 * `neutral` is the default "no urgency" tone (outline only). `success`,
 * `warning`, `danger` and `info` map to the semantic token pairs. Accent red is
 * intentionally absent here — it is for emphasis, never for status.
 */
export type StatusTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'

export interface StatusMeta {
  /** Lucide icon paired with the tone (never colour alone). */
  icon: LucideIcon
  /** Soft-fill utility classes (surface-level emphasis). */
  soft: string
  /** Solid-fill utility classes (reserve for the single most urgent item). */
  solid: string
  /** Outline-only utility classes (default, low-emphasis). */
  outline: string
  /** Foreground/icon colour for use on the app surface. */
  fg: string
}

export const STATUS_META: Record<StatusTone, StatusMeta> = {
  neutral: {
    icon: Info,
    soft: 'bg-surface-2 text-text',
    solid: 'bg-text text-bg',
    outline: 'border-outline text-text',
    fg: 'text-text-muted',
  },
  success: {
    icon: CheckCircle2,
    soft: 'bg-success-soft text-on-success-soft',
    solid: 'bg-success text-on-success',
    outline: 'border-success text-on-success-soft',
    fg: 'text-success',
  },
  warning: {
    icon: AlertTriangle,
    soft: 'bg-warning-soft text-on-warning-soft',
    solid: 'bg-warning text-on-warning',
    outline: 'border-warning text-on-warning-soft',
    fg: 'text-warning',
  },
  danger: {
    icon: OctagonAlert,
    soft: 'bg-danger-soft text-on-danger-soft',
    solid: 'bg-danger text-on-danger',
    outline: 'border-danger text-on-danger-soft',
    fg: 'text-danger',
  },
  info: {
    icon: Info,
    soft: 'bg-info-soft text-on-info-soft',
    solid: 'bg-info text-on-info',
    outline: 'border-info text-on-info-soft',
    fg: 'text-info',
  },
}
