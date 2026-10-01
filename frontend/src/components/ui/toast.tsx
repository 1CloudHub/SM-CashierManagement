import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { X } from 'lucide-react'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { STATUS_META, type StatusTone } from './status'

/**
 * Toast (SG-006, SG-007, UX-010).
 *
 * A transient confirmation that also stays visible on the page where it
 * matters — the toast is the polish, not the only signal (UX-010: "the result
 * is also visible on the page"). Success toasts dwell for --lw-toast-hold (5s)
 * and are announced politely; error toasts are announced assertively and do
 * NOT auto-dismiss (the user must see and act). Every toast pairs icon + text +
 * colour. The rise-in / fade-out motion drops to a fade under reduced motion.
 *
 * Timing (WCAG 2.2.1): the auto-dismiss countdown pauses while the pointer is
 * over a toast or focus is inside it, and resumes with the time that was left.
 * The viewport sits inside the device safe area (notches, home indicator).
 *
 * Usage: wrap the app in <ToastProvider>; call const { toast } = useToast().
 */
export interface ToastOptions {
  title: React.ReactNode
  description?: React.ReactNode
  tone?: StatusTone
  /** ms before auto-dismiss; 0 = sticky (default for errors). */
  durationMs?: number
}

interface ToastItem extends Required<Pick<ToastOptions, 'title' | 'tone'>> {
  id: number
  description?: React.ReactNode
  durationMs: number
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DEFAULT_HOLD_MS = 5000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((opts: ToastOptions) => {
    const id = nextId.current++
    const tone = opts.tone ?? 'success'
    // Errors are sticky by default so they aren't missed.
    const durationMs =
      opts.durationMs ?? (tone === 'danger' ? 0 : DEFAULT_HOLD_MS)
    setToasts((prev) => [
      ...prev,
      { id, title: opts.title, description: opts.description, tone, durationMs },
    ])
    return id
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: number) => void
}) {
  const t = useUiT()
  return (
    <div
      // A labelled region wrapping the toasts; each toast is its own live area
      // (status/alert) and sets its own politeness. role="region" makes the
      // aria-label valid (a bare div may not carry an accessible name).
      role="region"
      aria-label={t('ui.toast.region')}
      className="pointer-events-none fixed bottom-[max(var(--lw-space-4),env(safe-area-inset-bottom))] right-[max(var(--lw-space-4),env(safe-area-inset-right))] z-[60] flex w-[calc(100%-2*var(--lw-space-4))] max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: number) => void
}) {
  const t = useUiT()
  const meta = STATUS_META[toast.tone]
  const Icon = meta.icon
  const assertive = toast.tone === 'danger'
  const [hovered, setHovered] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const paused = hovered || focusWithin
  // Time left on the countdown; kept across pauses so resuming continues it.
  const remaining = useRef(toast.durationMs)

  useEffect(() => {
    if (toast.durationMs <= 0 || paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [paused, toast.durationMs, toast.id, onDismiss])

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false)
      }}
      className={cn(
        'pointer-events-auto flex items-start gap-3 border p-3 motion-safe:animate-toast-in',
        meta.soft,
        meta.outline,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-weight-semibold">{toast.title}</p>
        {toast.description && (
          <p className="text-body-sm">{toast.description}</p>
        )}
      </div>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('ui.toast.dismiss')}
        onClick={() => onDismiss(toast.id)}
        className="-my-2 -mr-2 shrink-0"
      >
        <X aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}
