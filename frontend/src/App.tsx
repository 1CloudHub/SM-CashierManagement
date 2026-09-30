import { cn } from '@/lib/utils'

/**
 * Placeholder starter screen. Everything here uses token-backed Tailwind
 * utilities (colours, type scale, spacing, motion) — no raw hex, px font
 * sizes or ad-hoc timings. It doubles as a smoke test that the token layer
 * and the Tailwind theme mapping resolve correctly.
 */
export function App() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-container-laptop px-4 py-12">
        <p className="text-label uppercase text-text-muted">
          LaneWise · by SM Retail
        </p>
        <h1 className="mt-2 text-display">Design tokens are wired up</h1>
        <p className="mt-4 max-w-prose text-body text-text-muted">
          The React + TypeScript SPA is scaffolded with Tailwind and a
          token-driven theme. Colour, typography, spacing, radius, elevation and
          motion are CSS variables consumed through the Tailwind config, so dark
          mode is a value swap and never a component change.
        </p>

        <section className="mt-8 flex flex-wrap gap-3">
          <StatusChip tone="primary">Primary</StatusChip>
          <StatusChip tone="success">Covered</StatusChip>
          <StatusChip tone="warning">Tight</StatusChip>
          <StatusChip tone="danger">Short</StatusChip>
          <StatusChip tone="info">Info</StatusChip>
        </section>

        <p className="mt-8 lw-numeric text-kpi text-primary">₱322,480</p>

        {/* Motion smoke test — exercises the animate-* + motion-* utilities so
            the theme mapping resolves. All honour prefers-reduced-motion. */}
        <section className="mt-8 flex flex-wrap items-center gap-3">
          <span className="animate-fade-in bg-surface px-3 py-1 text-body-sm text-text">
            Fade in
          </span>
          <span className="animate-toast-in bg-surface px-3 py-1 text-body-sm text-text">
            Toast rise
          </span>
          <span className="motion-skeleton bg-outline-subtle px-8 py-1" aria-hidden />
          <button
            type="button"
            className="motion-interactive bg-primary px-3 py-1 text-body-sm text-on-primary hover:opacity-90"
          >
            Interactive
          </button>
        </section>
      </div>
    </main>
  )
}

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info'

const toneClass: Record<Tone, string> = {
  primary: 'bg-primary text-on-primary',
  success: 'bg-success text-on-success',
  warning: 'bg-warning text-on-warning',
  danger: 'bg-danger text-on-danger',
  info: 'bg-info text-on-info',
}

function StatusChip({
  tone,
  children,
}: {
  tone: Tone
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-3 py-1 text-label uppercase transition-colors duration-fast ease-standard',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  )
}
