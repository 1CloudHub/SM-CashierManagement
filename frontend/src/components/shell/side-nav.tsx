import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useUiT } from '@/i18n/context'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * SideNav (UX-006 navigation, UX-005 hierarchy, UX-004).
 *
 * A labelled <nav> of grouped links matching the wireframe: an optional
 * ungrouped top block (Home, My roster) then titled sections (Plan, Scenarios,
 * Data, Rules, Admin). The active item carries `aria-current="page"` and a
 * 2px leading marker + fill (never colour alone). Icons are decorative
 * (aria-hidden); the label is the accessible name. Screens filter items by role
 * before passing them in — the nav only renders what it is given.
 *
 * Collapsing: pass `collapsed` to render an icon-only rail. The parent owns the
 * state (composable, and lets it persist / respond to breakpoints). When
 * collapsed, section headings and text labels are hidden from view but each
 * link keeps its accessible name via `aria-label` + a `title` tooltip, so the
 * rail is still fully usable with a screen reader or on hover. A built-in
 * icon toggle at the top of the nav (shown when `onToggleCollapsed` is
 * provided) exposes the state with `aria-expanded` / `aria-controls`.
 */
export interface NavItem {
  label: string
  href: string
  /** Decorative leading glyph/icon node (aria-hidden). */
  icon?: React.ReactNode
  current?: boolean
}

export interface NavSection {
  /** Section heading; omit for the ungrouped top block. */
  title?: string
  items: NavItem[]
}

export function SideNav({
  sections,
  className,
  id = 'sidenav',
  label,
  collapsed = false,
  onToggleCollapsed,
  collapseLabel,
  expandLabel,
}: {
  sections: NavSection[]
  className?: string
  id?: string
  label?: string
  /** Render as an icon-only rail. Parent-owned so it can persist. */
  collapsed?: boolean
  /** When provided, renders an icon collapse/expand toggle at the top of the nav. */
  onToggleCollapsed?: () => void
  /** Accessible names for the toggle (from the i18n bundle). */
  collapseLabel?: string
  expandLabel?: string
}) {
  const t = useUiT()
  const toggleLabel = collapsed
    ? (expandLabel ?? t('shell.navExpand'))
    : (collapseLabel ?? t('shell.navCollapse'))
  return (
    <nav
      id={id}
      aria-label={label ?? t('shell.navLabel')}
      data-collapsed={collapsed || undefined}
      className={cn(
        'flex flex-col gap-4 border-r border-outline bg-surface py-3 motion-base',
        collapsed ? 'w-16' : 'w-full',
        className,
      )}
    >
      {onToggleCollapsed && (
        <div className={cn('flex px-2', collapsed ? 'justify-center px-0' : 'justify-end')}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={id}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-5" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-5" />
            )}
          </Button>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4">
        {sections.map((section, i) => (
          <div key={i}>
            {section.title && !collapsed && (
              <h2 className="px-4 pb-1 text-label uppercase text-text-muted">
                {section.title}
              </h2>
            )}
            {/* When collapsed, a thin rule stands in for the (hidden) heading so
                groups stay visually separated. */}
            {section.title && collapsed && i > 0 && (
              <hr className="mx-3 mb-1 border-t border-outline-subtle" />
            )}
            <ul>
              {section.items.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={item.current ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'motion-interactive flex min-h-tap items-center gap-2 border-l-2 border-transparent px-4 text-body text-text no-underline hover:bg-surface-2 focus-visible:outline-focus-ring',
                      collapsed && 'justify-center px-0',
                      item.current &&
                        'border-l-primary bg-surface-2 font-weight-semibold',
                    )}
                  >
                    {item.icon && (
                      <span
                        aria-hidden="true"
                        className="grid size-5 shrink-0 place-items-center text-text-muted"
                      >
                        {item.icon}
                      </span>
                    )}
                    {!collapsed && <span>{item.label}</span>}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

    </nav>
  )
}
