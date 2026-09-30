/**
 * LaneWise accessibility layer (task 1.7 — UX-001, UX-004, NFR-A11Y-001).
 *
 * The cross-cutting a11y building blocks every screen reuses so the WCAG 2.2 AA
 * structure (landmarks, skip link, focus management, live regions, the
 * ARIA/labelling standard) is established once, not re-invented per screen:
 *
 *   - SkipLink              first focusable element; jumps to the #main landmark
 *   - AnnouncerProvider     mount-once polite/assertive live regions …
 *     useAnnouncer            … pushed to via this hook for async results
 *     useAnnounce             announce a derived string whenever it changes
 *   - useRouteFocus         move focus to #main on SPA route change
 *   - useRestoreFocus       return focus to the trigger when a surface closes
 *   - labelling             the documented ARIA/labelling standard + helpers
 *     describedBy             merge aria-describedby id lists
 *     menuTrigger             wire a menu/popover trigger to its surface
 *     cellActionLabel         descriptive names for dense grid cell actions
 *     timelineShiftLabel      descriptive names for roster timeline shifts
 *
 * Full WCAG conformance still requires manual assistive-technology testing;
 * these primitives + the automated axe checks establish the structure.
 */
export { SkipLink } from './skip-link'
export {
  AnnouncerProvider,
  useAnnouncer,
  useAnnounce,
  type Politeness,
} from './announcer'
export { useRouteFocus, useRestoreFocus } from './use-route-focus'
export {
  describedBy,
  menuTrigger,
  cellActionLabel,
  timelineShiftLabel,
} from './labelling'
