import type { Bundle } from './types'

/**
 * UI kit and app-shell copy (en/fil): the strings the shared components
 * (`components/ui`, `components/shell`, `components/layout`) render
 * themselves — close buttons, live-region names, the shell's menus. Kept
 * apart from feature bundles so the kit's copy has one home. The kit reads it
 * through `useUiT()`, which falls back to English outside an I18nProvider.
 */
export const uiEn: Bundle = {
  // ── UI kit ──────────────────────────────────────────────────────────────
  'ui.dialog.close': 'Close',
  'ui.toast.region': 'Notifications',
  'ui.toast.dismiss': 'Dismiss notification',
  'ui.button.working': 'Working…',
  'ui.field.required': '(required)',
  'ui.breadcrumb': 'Breadcrumb',

  // ── Shell ───────────────────────────────────────────────────────────────
  'shell.openNav': 'Open navigation',
  'shell.navDrawerTitle': 'Navigation',
  'shell.searchToggle': 'Search',
  'shell.searchDialogTitle': 'Search',
  'shell.closeSearch': 'Close search',
  'shell.byline': 'by SM Retail',
  'shell.notifications': 'Notifications',
  'shell.notificationsUnread': 'Notifications, {count} unread',
  'shell.theme.toDark': 'Switch to dark theme',
  'shell.theme.toLight': 'Switch to light theme',
  'shell.userMenu': 'Account menu',
  'shell.userMenu.profile': 'Profile',
  'shell.userMenu.help': 'Help and shortcuts',
  'shell.userMenu.signOut': 'Sign out',
}

export const uiFil: Bundle = {
  'ui.dialog.close': 'Isara',
  'ui.toast.region': 'Mga abiso',
  'ui.toast.dismiss': 'Isara ang abiso',
  'ui.button.working': 'Pinoproseso…',
  'ui.field.required': '(kailangan)',
  'ui.breadcrumb': 'Breadcrumb',

  'shell.openNav': 'Buksan ang nabigasyon',
  'shell.navDrawerTitle': 'Nabigasyon',
  'shell.searchToggle': 'Maghanap',
  'shell.searchDialogTitle': 'Maghanap',
  'shell.closeSearch': 'Isara ang paghahanap',
  'shell.byline': 'ng SM Retail',
  'shell.notifications': 'Mga abiso',
  'shell.notificationsUnread': 'Mga abiso, {count} hindi pa nababasa',
  'shell.theme.toDark': 'Lumipat sa madilim na tema',
  'shell.theme.toLight': 'Lumipat sa maliwanag na tema',
  'shell.userMenu': 'Menu ng account',
  'shell.userMenu.profile': 'Profile',
  'shell.userMenu.help': 'Tulong at mga shortcut',
  'shell.userMenu.signOut': 'Mag-sign out',
}
