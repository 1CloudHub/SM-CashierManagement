import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * Dialog & Drawer (SG-006, SG-007, UX-004).
 *
 * Built on Radix Dialog so focus trap, Esc-to-close, aria-modal, labelling and
 * scroll-lock are correct by default. Two presentations share the same
 * primitives:
 *   - Dialog: centred modal, fades + settles in (`animate-dialog-in`), used for
 *     confirmations (destructive actions name the object + effect) and forms.
 *   - Drawer: edge panel, slides in (`motion-panel`), used for detail/edit side
 *     panels and the mobile nav.
 *
 * Every dialog/drawer needs a Title (labels the modal). Use DialogDescription
 * for the supporting line so it is announced. The overlay uses the --lw-scrim
 * token (dark in both themes). A centred dialog is capped at the viewport
 * height and scrolls; a drawer scrolls at full dynamic viewport height. Motion drops to a short fade
 * under prefers-reduced-motion (handled in motion.css).
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogPortal = DialogPrimitive.Portal

function Overlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-40 bg-scrim motion-safe:animate-fade-in',
        className,
      )}
      {...props}
    />
  )
}

export interface DialogContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content> {
  /** "dialog" (centred) or "drawer" (right edge panel). */
  variant?: 'dialog' | 'drawer'
  /** Hide the built-in close button (e.g. a mandatory-choice dialog). */
  hideClose?: boolean
}

export function DialogContent({
  variant = 'dialog',
  hideClose = false,
  className,
  children,
  ...props
}: DialogContentProps) {
  const t = useUiT()
  return (
    <DialogPortal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col gap-4 border border-outline bg-surface p-6 focus-visible:outline-focus-ring',
          variant === 'dialog'
            ? // Centred: never taller than the viewport; long content scrolls
            // inside the dialog (dvh tracks mobile browser chrome).
            'left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto motion-safe:animate-dialog-in'
            : 'right-0 top-0 h-dvh w-full max-w-md overflow-y-auto motion-panel',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('ui.dialog.close')}
              className="absolute right-3 top-3"
            >
              <X aria-hidden="true" className="size-5" />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-h2 text-text', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-body text-text-muted', className)}
      {...props}
    />
  )
}

export function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'mt-2 flex flex-wrap justify-end gap-3',
        className,
      )}
      {...props}
    />
  )
}
