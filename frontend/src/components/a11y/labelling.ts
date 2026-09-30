/**
 * ARIA and labelling standard (UX-004, design.md "ARIA and labelling standard").
 *
 * The single source of truth for how LaneWise names, describes and structures
 * interactive UI for assistive technology. The task 1.4/1.6 primitives already
 * ship with correct roles + accessible names by default; this module documents
 * the standard they follow and provides the small, reusable helpers screens
 * need so they never re-invent labelling. Everything user-facing (labels,
 * announcements) is expected to come from the i18n bundles (task 1.8) — the
 * helpers here compose already-localised strings, they do not hardcode copy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The standard (what every screen and component must satisfy)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. Accessible name on every control.
 *    - Text buttons/links: the visible text is the name.
 *    - Icon-only buttons (Button size="icon"): MUST pass `aria-label`; the icon
 *      is `aria-hidden`. The Button dev-warns when this is missing.
 *    - Inputs/selects/textarea: associated via <Field> (label + htmlFor + id),
 *      or a `sr-only` <label> when the control stands alone (e.g. search).
 *    - Decorative icons/glyphs are always `aria-hidden="true"`.
 *
 * 2. Landmarks + skip link (this task).
 *    - One <header> banner (TopBar), one primary <nav> (SideNav), one <main>
 *      (Page as="main" id="main"). The <SkipLink> jumps to #main; #main is
 *      focusable (tabIndex -1) so focus lands there.
 *    - Never mount two primary navs at once (the shell renders a single nav per
 *      breakpoint) so the navigation landmark stays unique.
 *
 * 3. Composite-widget patterns (roles come from the primitives):
 *    - Tabs   — Radix Tabs: role tablist/tab/tabpanel, roving focus,
 *               aria-selected. Selection is carried by aria-selected + fill,
 *               never by motion or colour alone.
 *    - Dialog — Radix Dialog: role dialog, aria-modal, focus trap, Esc-close.
 *               Every dialog needs a <DialogTitle> (labels it) and, where there
 *               is a supporting line, a <DialogDescription> (describes it).
 *    - Menu   — trigger carries aria-haspopup="menu" + aria-expanded +
 *               aria-controls; use `menuTrigger()` to wire the ids.
 *    - Grid   — dense data tables use real <table> semantics with a <caption>,
 *               column headers (<th scope="col">) and a row header
 *               (<th scope="row">) per row. Cell actions are buttons with
 *               descriptive labels (see `cellActionLabel`), not bare icons.
 *    - Timeline — the roster timeline is a labelled group; each shift is a
 *               button with a descriptive name (see `timelineShiftLabel`) and a
 *               keyboard equivalent for every pointer action (task 1.9).
 *
 * 4. Live regions for async results (this task).
 *    - Use the <Announcer> / `useAnnouncer` from ./announcer. Success and
 *      neutral results announce politely; errors announce assertively. Toasts
 *      already self-announce; the announcer is for in-page async results that
 *      have no toast (filter counts, autosave, background loads).
 *
 * 5. Status is never colour alone.
 *    - Status pills pair text + icon + colour (STATUS_META). Heatmap cells show
 *      their value. Required markers show a "*" + "(required)" sr-only text.
 *
 * The helpers below cover the fiddly, easy-to-get-wrong bits (describedBy
 * merging, id wiring for menus, descriptive labels for dense grid cells and
 * timeline shifts) so callers pass in localised fragments and get correct ARIA.
 */

/**
 * Merge several `aria-describedby` / id token strings into one, dropping empties
 * and de-duplicating. Returns `undefined` when nothing is left so the attribute
 * is omitted rather than rendered empty.
 *
 * describedBy('hint-1', undefined, 'err-1') → "hint-1 err-1"
 */
export function describedBy(
  ...ids: Array<string | false | null | undefined>
): string | undefined {
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    for (const token of id.split(/\s+/)) {
      if (token) seen.add(token)
    }
  }
  return seen.size ? Array.from(seen).join(' ') : undefined
}

/**
 * Wire a menu/popover trigger to its surface. Spread the returned props on the
 * trigger and set `id={menu.id}` on the surface. `expanded` reflects open state.
 *
 *   const menu = menuTrigger('user-menu', open)
 *   <Button {...menu.triggerProps} aria-label={t('account')} />
 *   <ul id={menu.id} role="menu">…</ul>
 */
export function menuTrigger(id: string, expanded: boolean) {
  return {
    id,
    triggerProps: {
      'aria-haspopup': 'menu' as const,
      'aria-expanded': expanded,
      'aria-controls': id,
    },
  }
}

/**
 * Build a descriptive accessible name for an action button inside a dense grid
 * cell, per the standard ("Mark PT-02 unavailable on Sat Dec 19", not just an
 * icon). Callers pass already-localised parts.
 *
 *   cellActionLabel(t('markUnavailable'), 'PT-02', t('date.satDec19'))
 *     → "Mark unavailable — PT-02, Sat Dec 19"
 *
 * @param action  the localised verb phrase ("Mark unavailable", "Edit shift")
 * @param subject the entity the action targets ("PT-02", "Lane 3")
 * @param context optional extra context ("Sat Dec 19", "morning")
 */
export function cellActionLabel(
  action: string,
  subject: string,
  context?: string,
): string {
  const head = `${action} — ${subject}`
  return context ? `${head}, ${context}` : head
}

/**
 * Build the accessible name for a shift block on the roster timeline. The bar
 * shows the time as text too — this is the name a screen-reader user hears when
 * focus lands on the shift. Callers pass localised parts.
 *
 *   timelineShiftLabel('PT-02', '09:00–13:00', t('lane', { n: 3 }))
 *     → "PT-02, 09:00–13:00, Lane 3"
 */
export function timelineShiftLabel(
  staff: string,
  timeRange: string,
  lane?: string,
): string {
  return [staff, timeRange, lane].filter(Boolean).join(', ')
}
