import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

/**
 * Tabs (SG-006, SG-007 motion, UX-004).
 *
 * Built on Radix Tabs so roles, roving focus and aria-selected are correct by
 * default. Visual language: square corners, 2px outline, the active tab is a
 * surface fill (no shadow, no sliding underline). The fill CROSS-FADES via
 * `motion-tab` at --lw-dur-fast; selection is also carried by aria-selected +
 * the fill, never by motion alone.
 */
export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex flex-wrap gap-1 border-b border-outline',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'motion-tab -mb-0.5 min-h-tap border border-b-0 border-transparent bg-transparent px-4 text-body text-text-muted',
        'hover:bg-surface-2',
        'data-[state=active]:border-outline data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:font-weight-semibold',
        'focus-visible:outline-focus-ring',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'py-4 focus-visible:outline-focus-ring motion-safe:animate-fade-in',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SegmentedControl — the pill-shaped view switcher from the roster wireframe
 * (`.seg`): Day / Week / Month. Same Radix tabs semantics, pill container.
 */
export function SegmentedControl({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex gap-1 rounded-full border border-outline bg-surface p-1',
        className,
      )}
      {...props}
    />
  )
}

export function SegmentedItem({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'motion-tab min-h-tap rounded-full px-4 text-body-sm text-text-muted',
        'data-[state=active]:bg-surface-2 data-[state=active]:text-text data-[state=active]:font-weight-semibold',
        'focus-visible:outline-focus-ring',
        className,
      )}
      {...props}
    />
  )
}
