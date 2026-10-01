/**
 * Resource bundles + canonical microcopy reference (task 1.8 — req. 23, UX-003,
 * UX-011, NFR-L10N-001).
 *
 * This is the single externalised store of user-facing copy. Every string the
 * UI shows — actions, states, errors, a11y announcements, switcher labels —
 * lives here keyed by a stable dotted id, in English (canonical) and Filipino.
 * Components resolve copy via `useI18n()` / `t()` (see ./context); they never
 * hardcode strings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Microcopy and voice conventions (UX-003, mirrored in docs/06-ux-system/03)
 * ─────────────────────────────────────────────────────────────────────────
 * One voice across the app: clear, supportive, plain language.
 *  - Sentence case for labels and buttons ("Send offers", not "Send Offers").
 *  - Buttons are verbs that say what happens ("Approve budget", "Publish
 *    plan") — never "OK"/"Submit" where a specific verb fits.
 *  - Empty states explain why and offer the next step.
 *  - Errors say what went wrong and how to recover; no jargon, no blame, no
 *    stack traces or object details.
 *  - Destructive confirmations name the object and its effect.
 *  - ₱ / dates / numbers are formatted via ./format, never written into copy.
 *
 * Key naming: `<area>.<thing>` — e.g. `action.save`, `state.empty.title`,
 * `error.404.title`. Keep ids stable; never reuse an id for different copy.
 *
 * The English bundle is the canonical key set. A test (resources.test.ts)
 * asserts every other locale covers exactly the same keys, so a missing or
 * stray translation fails CI rather than silently falling back.
 */

import { appEn, appFil } from './app-messages'
import { approvalsEn, approvalsFil } from './approvals-messages'
import { authEn, authFil } from './auth-messages'
import { dataEn, dataFil } from './data-messages'
import { locationPrivacyEn, locationPrivacyFil } from './location-privacy-messages'
import { networkMapEn, networkMapFil } from './network-map-messages'
import { notificationsEn, notificationsFil } from './notifications-messages'
import { planningEn, planningFil } from './planning-messages'
import { rosterEn, rosterFil } from './roster-messages'
import { rulesEn, rulesFil } from './rules-messages'
import { scenariosEn, scenariosFil } from './scenarios-messages'
import { searchEn, searchFil } from './search-messages'
import type { Bundle, Locale } from './types'

const en: Bundle = {
  // ── Common actions (verbs — UX-003) ──────────────────────────────────────
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.close': 'Close',
  'action.confirm': 'Confirm',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.retry': 'Try again',
  'action.back': 'Go back',
  'action.home': 'Go to Home',
  'action.signIn': 'Sign in',
  'action.search': 'Search',
  'action.recalculate': 'Recalculate',
  'action.discard': 'Discard changes',
  'action.duplicateAsDraft': 'Duplicate as draft',
  'action.sendOffers': 'Send offers',
  'action.publishPlan': 'Publish plan',
  'action.approveBudget': 'Approve budget',
  'action.approveHeadcount': 'Approve headcount',
  'action.archiveScenario': 'Archive scenario',
  'action.openScenarios': 'Open scenarios',

  // ── States and feedback (UX-010) ─────────────────────────────────────────
  'state.loading': 'Loading…',
  'state.empty.title': 'Nothing here yet',
  'state.empty.description': 'When there is something to show, it appears here.',
  'state.noAccess.title': 'You don’t have access to this',
  'state.noAccess.description':
    'This is outside your role or stores. Nothing about it is shown here.',
  'state.error.title': 'Something went wrong',
  'state.error.description': 'We couldn’t load this view. Try again in a moment.',
  'state.stale.title': 'Data changed since this run',
  'state.stale.description':
    'The snapshot or rules are newer than this run. Recalculate to refresh.',
  'state.unsaved.title': 'Discard changes?',
  'state.unsaved.description':
    'You have unsaved changes. Leaving this page will discard them.',
  'state.success.saved': 'Saved',
  'state.success.published': 'Plan published',

  // ── Accessibility / announcements (UX-004) ───────────────────────────────
  'a11y.skipToMain': 'Skip to main content',
  'a11y.errorPage': 'Error page:',
  'a11y.referenceId': 'Reference ID',
  'a11y.mainContent': 'Main content',
  'a11y.search': 'Search',

  // ── Keyboard shortcuts and help (task 1.9 — UX-003, UX-004, SG-000) ──────
  'help.open': 'Help and shortcuts',
  'help.title': 'Help and shortcuts',
  'help.description':
    'A quick guide and every keyboard shortcut. Shortcuts are optional — everything is also reachable with the mouse and Tab.',
  'help.shortcutsHeading': 'Keyboard shortcuts',
  'help.guideHeading': 'How it works',
  'help.guide.body':
    'LaneWise turns store demand into lane counts, shifts and a weekly roster you can adjust. Figures come from your scenario’s snapshot and rules; when either changes, a run is marked stale so you can recalculate.',
  'help.links.methodology': 'How the numbers are calculated',
  'help.links.support': 'Contact support',
  'help.empty.title': 'No shortcuts on this screen',
  'help.empty.description':
    'This screen adds no shortcuts of its own. The global shortcuts above still work.',
  'help.keySequenceThen': 'then',
  'help.openReferenceHint': 'Press ? for the shortcut reference',

  // Shortcut groups (headings in the reference).
  'shortcut.group.global': 'Global',
  'shortcut.group.navigation': 'Go to',
  'shortcut.group.roster': 'Roster timeline',

  // Global shortcut descriptions.
  'shortcut.search': 'Search stores, departments, scenarios and staff',
  'shortcut.help': 'Open this shortcut reference',
  'shortcut.notifications': 'Open notifications',
  'shortcut.close': 'Close a dialog, menu or panel',
  'shortcut.goHome': 'Go to Home',
  'shortcut.goRoster': 'Go to the weekly roster',
  'shortcut.goMap': 'Go to the network map',

  // Roster-timeline (context) shortcut descriptions.
  'shortcut.roster.move': 'Move focus between shifts',
  'shortcut.roster.open': 'Open the focused shift',
  'shortcut.roster.nudgeEarlier': 'Move the shift 15 minutes earlier',
  'shortcut.roster.nudgeLater': 'Move the shift 15 minutes later',
  'shortcut.roster.selectAll': 'Select all shifts in the row',

  // ── Field-level info popover (UX-004: never tooltip-only for essentials) ──
  'infoPopover.trigger': 'More information',
  'infoPopover.close': 'Close',

  // ── Language switcher (req. 23.1) ────────────────────────────────────────
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.fil': 'Filipino',

  // ── Sample-data provenance (req. 18) ─────────────────────────────────────
  'sampleData.title': 'Sample data',
  'sampleData.description': 'Figures are simulated, not SM actuals.',

  // ── Error / status pages (SCR-090, migrated from errors/messages) ────────
  'error.400.code': '400',
  'error.400.title': 'That request could not be understood',
  'error.400.description':
    'Something about the last request was off. Go back and try again, or return to Home.',
  'error.401.code': '401',
  'error.401.title': 'Please sign in to continue',
  'error.401.description':
    'Your session has ended. Sign in and we will take you back to where you left off.',
  'error.403.code': '403',
  'error.403.title': 'You do not have access to this',
  'error.403.description':
    'You are signed in, but this is outside your role or stores. Nothing about it is shown here.',
  'error.404.code': '404',
  'error.404.title': 'We could not find that page',
  'error.404.description':
    'The page may have moved or the link may be out of date. Try search, or return to Home.',
  'error.429.code': '429',
  'error.429.title': 'Too many requests just now',
  'error.429.description':
    'That happened a lot in a short time. Wait a moment, then try again.',
  'error.500.code': '500',
  'error.500.title': 'Something went wrong on our side',
  'error.500.description':
    'This is a problem with the app, not with what you did. Try again in a moment, or return to Home.',
  'error.503.code': '503',
  'error.503.title': 'The service is temporarily unavailable',
  'error.503.description':
    'We are briefly offline, likely for maintenance. Try again shortly, or return to Home.',
  'error.offline.code': 'Offline',
  'error.offline.title': 'You appear to be offline',
  'error.offline.description':
    'We cannot reach the server. Your unsaved work is kept on this device. Retry when your connection is back.',
}

const fil: Bundle = {
  // ── Common actions ───────────────────────────────────────────────────────
  'action.save': 'I-save',
  'action.cancel': 'Kanselahin',
  'action.close': 'Isara',
  'action.confirm': 'Kumpirmahin',
  'action.delete': 'Tanggalin',
  'action.edit': 'I-edit',
  'action.retry': 'Subukang muli',
  'action.back': 'Bumalik',
  'action.home': 'Pumunta sa Home',
  'action.signIn': 'Mag-sign in',
  'action.search': 'Maghanap',
  'action.recalculate': 'Muling kalkulahin',
  'action.discard': 'Itapon ang mga pagbabago',
  'action.duplicateAsDraft': 'I-duplicate bilang draft',
  'action.sendOffers': 'Ipadala ang mga alok',
  'action.publishPlan': 'I-publish ang plano',
  'action.approveBudget': 'Aprubahan ang badyet',
  'action.approveHeadcount': 'Aprubahan ang headcount',
  'action.archiveScenario': 'I-archive ang scenario',
  'action.openScenarios': 'Buksan ang mga scenario',

  // ── States and feedback ──────────────────────────────────────────────────
  'state.loading': 'Naglo-load…',
  'state.empty.title': 'Wala pang laman dito',
  'state.empty.description': 'Kapag may maipapakita, lalabas ito rito.',
  'state.noAccess.title': 'Wala kang access dito',
  'state.noAccess.description':
    'Nasa labas ito ng iyong tungkulin o mga tindahan. Walang ipinapakita tungkol dito.',
  'state.error.title': 'May nagkamali',
  'state.error.description':
    'Hindi namin ma-load ang view na ito. Subukang muli mamaya.',
  'state.stale.title': 'Nagbago ang datos mula noong huling run',
  'state.stale.description':
    'Mas bago ang snapshot o mga panuntunan kaysa sa run na ito. Muling kalkulahin para i-refresh.',
  'state.unsaved.title': 'Itapon ang mga pagbabago?',
  'state.unsaved.description':
    'May mga hindi pa na-save na pagbabago. Kung aalis ka sa pahinang ito, matatapon ang mga ito.',
  'state.success.saved': 'Na-save',
  'state.success.published': 'Na-publish ang plano',

  // ── Accessibility / announcements ────────────────────────────────────────
  'a11y.skipToMain': 'Lumaktaw sa pangunahing nilalaman',
  'a11y.errorPage': 'Pahina ng error:',
  'a11y.referenceId': 'Reference ID',
  'a11y.mainContent': 'Pangunahing nilalaman',
  'a11y.search': 'Maghanap',

  // ── Keyboard shortcuts and help (task 1.9) ───────────────────────────────
  'help.open': 'Tulong at mga shortcut',
  'help.title': 'Tulong at mga shortcut',
  'help.description':
    'Isang mabilis na gabay at lahat ng keyboard shortcut. Opsyonal ang mga shortcut — maaari ring maabot ang lahat gamit ang mouse at Tab.',
  'help.shortcutsHeading': 'Mga keyboard shortcut',
  'help.guideHeading': 'Paano ito gumagana',
  'help.guide.body':
    'Ginagawang lane count, shift at lingguhang roster ng LaneWise ang demand ng tindahan na maaari mong i-adjust. Nagmumula ang mga numero sa snapshot at mga panuntunan ng iyong scenario; kapag nagbago ang alinman, mamamarkahang stale ang run para muli mong makalkula.',
  'help.links.methodology': 'Paano kinakalkula ang mga numero',
  'help.links.support': 'Makipag-ugnayan sa suporta',
  'help.empty.title': 'Walang shortcut sa screen na ito',
  'help.empty.description':
    'Walang idinaragdag na sariling shortcut ang screen na ito. Gumagana pa rin ang mga global na shortcut sa itaas.',
  'help.keySequenceThen': 'tapos',
  'help.openReferenceHint': 'Pindutin ang ? para sa listahan ng shortcut',

  // Mga pangkat ng shortcut.
  'shortcut.group.global': 'Global',
  'shortcut.group.navigation': 'Pumunta sa',
  'shortcut.group.roster': 'Roster timeline',

  // Mga global na shortcut.
  'shortcut.search': 'Maghanap ng tindahan, departamento, scenario at tauhan',
  'shortcut.help': 'Buksan ang listahan ng shortcut na ito',
  'shortcut.notifications': 'Buksan ang mga notipikasyon',
  'shortcut.close': 'Isara ang dialog, menu o panel',
  'shortcut.goHome': 'Pumunta sa Home',
  'shortcut.goRoster': 'Pumunta sa lingguhang roster',
  'shortcut.goMap': 'Pumunta sa network map',

  // Mga shortcut sa roster timeline.
  'shortcut.roster.move': 'Ilipat ang focus sa pagitan ng mga shift',
  'shortcut.roster.open': 'Buksan ang naka-focus na shift',
  'shortcut.roster.nudgeEarlier': 'Iagap ng 15 minuto ang shift',
  'shortcut.roster.nudgeLater': 'Ihuli ng 15 minuto ang shift',
  'shortcut.roster.selectAll': 'Piliin ang lahat ng shift sa row',

  // ── Field-level info popover ─────────────────────────────────────────────
  'infoPopover.trigger': 'Higit pang impormasyon',
  'infoPopover.close': 'Isara',

  // ── Language switcher ────────────────────────────────────────────────────
  'lang.label': 'Wika',
  'lang.en': 'Ingles',
  'lang.fil': 'Filipino',

  // ── Sample-data provenance ───────────────────────────────────────────────
  'sampleData.title': 'Halimbawang datos',
  'sampleData.description':
    'Ang mga numero ay simulasyon, hindi aktwal na datos ng SM.',

  // ── Error / status pages ─────────────────────────────────────────────────
  'error.400.code': '400',
  'error.400.title': 'Hindi maunawaan ang kahilingan',
  'error.400.description':
    'May mali sa huling kahilingan. Bumalik at subukang muli, o pumunta sa Home.',
  'error.401.code': '401',
  'error.401.title': 'Mag-sign in para magpatuloy',
  'error.401.description':
    'Natapos na ang iyong session. Mag-sign in at ibabalik ka namin sa huling pinuntahan mo.',
  'error.403.code': '403',
  'error.403.title': 'Wala kang access dito',
  'error.403.description':
    'Naka-sign in ka, ngunit nasa labas ito ng iyong tungkulin o mga tindahan. Walang ipinapakita tungkol dito.',
  'error.404.code': '404',
  'error.404.title': 'Hindi namin makita ang pahinang iyon',
  'error.404.description':
    'Maaaring lumipat ang pahina o luma na ang link. Subukan ang paghahanap, o pumunta sa Home.',
  'error.429.code': '429',
  'error.429.title': 'Masyadong maraming kahilingan ngayon',
  'error.429.description':
    'Madalas iyong nangyari sa maikling panahon. Maghintay saglit, pagkatapos ay subukang muli.',
  'error.500.code': '500',
  'error.500.title': 'May nagkamali sa aming panig',
  'error.500.description':
    'Problema ito ng app, hindi ng ginawa mo. Subukang muli mamaya, o pumunta sa Home.',
  'error.503.code': '503',
  'error.503.title': 'Pansamantalang hindi magamit ang serbisyo',
  'error.503.description':
    'Sandaling offline kami, malamang para sa maintenance. Subukang muli sa ilang saglit, o pumunta sa Home.',
  'error.offline.code': 'Offline',
  'error.offline.title': 'Mukhang offline ka',
  'error.offline.description':
    'Hindi namin maabot ang server. Nakatago ang hindi mo pa na-save sa device na ito. Subukang muli kapag bumalik ang koneksyon.',
}

/** All bundles, keyed by locale. English is the canonical key set. */
export const BUNDLES: Record<Locale, Bundle> = {
  en: { ...en, ...authEn, ...appEn, ...rosterEn, ...searchEn, ...dataEn, ...rulesEn, ...scenariosEn, ...locationPrivacyEn, ...approvalsEn, ...planningEn, ...notificationsEn, ...networkMapEn },
  fil: { ...fil, ...authFil, ...appFil, ...rosterFil, ...searchFil, ...dataFil, ...rulesFil, ...scenariosFil, ...locationPrivacyFil, ...approvalsFil, ...planningFil, ...notificationsFil, ...networkMapFil },
}
