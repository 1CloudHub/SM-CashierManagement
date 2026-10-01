/**
 * Notifications — event catalogue, channel policy and wire contracts
 * (design.md › Notifications; requirement 20; task 19; P1, P11).
 *
 * Every notification row names an `event`; the catalogue below maps it to a
 * preference category, its email policy and the SPA screen it deep-links to.
 * Preferences are kept per user per category and channel (in-app / email).
 * Approvals and security notices — and any critical item — cannot be turned
 * off (requirement 20.3); email goes out immediately per event, never as a
 * digest (20.2, Q7).
 */
import type { IsoDateTime, Language } from './entities.js';

export const NOTIFICATION_CATEGORIES = [
  'approvals',
  'plans',
  'hiring',
  'scenarios',
  'roster',
  'offers',
  'borrow',
  'data',
  'rules',
  'security',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Categories whose notifications always reach the user on both channels (requirement 20.3). */
export const MANDATORY_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['approvals', 'security'];

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

/**
 * Email policy for an event: `always` (unless the user turned the category's
 * email off), or `never` (in-app only, e.g. "offer accepted"). A critical
 * notification is emailed regardless (e.g. "run failed", "ingestion failed").
 */
export type NotificationEmailPolicy = 'always' | 'never';

export interface NotificationEventDef {
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly email: NotificationEmailPolicy;
}

/** The events of design.md › Notifications, by wire name. */
export const NOTIFICATION_EVENTS = {
  'approval.headcount_requested': { category: 'approvals', severity: 'info', email: 'always' },
  'approval.budget_requested': { category: 'approvals', severity: 'info', email: 'always' },
  'approval.secured': { category: 'approvals', severity: 'info', email: 'always' },
  'approval.plan_ready': { category: 'approvals', severity: 'info', email: 'always' },
  'approval.decided': { category: 'approvals', severity: 'info', email: 'always' },
  'scenario.paused': { category: 'approvals', severity: 'warning', email: 'always' },
  'scenario.published': { category: 'plans', severity: 'info', email: 'always' },
  'plan.lane_capacity_exceeded': { category: 'plans', severity: 'warning', email: 'always' },
  'hiring.milestone_due': { category: 'hiring', severity: 'warning', email: 'always' },
  'hiring.milestone_overdue': { category: 'hiring', severity: 'critical', email: 'always' },
  'scenario.stale': { category: 'scenarios', severity: 'warning', email: 'always' },
  'scenario_run.completed': { category: 'scenarios', severity: 'info', email: 'never' },
  'scenario_run.failed': { category: 'scenarios', severity: 'critical', email: 'always' },
  'roster.published': { category: 'roster', severity: 'info', email: 'always' },
  'shift.changed': { category: 'roster', severity: 'info', email: 'always' },
  'roster.unfilled_shifts': { category: 'roster', severity: 'warning', email: 'always' },
  'roster.override_rule_breach': { category: 'roster', severity: 'warning', email: 'always' },
  'offer.sent': { category: 'offers', severity: 'info', email: 'always' },
  'offer.resolved': { category: 'offers', severity: 'info', email: 'never' },
  'borrow.requested': { category: 'borrow', severity: 'info', email: 'always' },
  'staff_request.submitted': { category: 'roster', severity: 'info', email: 'always' },
  'staff_request.decided': { category: 'roster', severity: 'info', email: 'always' },
  'borrow.decided': { category: 'borrow', severity: 'info', email: 'never' },
  'ingestion.succeeded': { category: 'data', severity: 'info', email: 'never' },
  'ingestion.failed': { category: 'data', severity: 'critical', email: 'always' },
  'rule_version.published': { category: 'rules', severity: 'info', email: 'always' },
  'passkey.added': { category: 'security', severity: 'warning', email: 'always' },
} as const satisfies Readonly<Record<string, NotificationEventDef>>;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;
export const NOTIFICATION_EVENT_NAMES = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NOTIFICATION_EVENTS, value);
}

export function isNotificationCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/** The category of an event; `null` for an event outside the catalogue. */
export function notificationCategory(event: string): NotificationCategory | null {
  return isNotificationEvent(event) ? NOTIFICATION_EVENTS[event].category : null;
}

/** Events in the given categories (for filtering by category in SQL). */
export function eventsInCategories(categories: readonly NotificationCategory[]): NotificationEvent[] {
  return NOTIFICATION_EVENT_NAMES.filter((e) => categories.includes(NOTIFICATION_EVENTS[e].category));
}

export function isMandatoryCategory(category: NotificationCategory): boolean {
  return MANDATORY_NOTIFICATION_CATEGORIES.includes(category);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/** One category's channel settings for a user. `locked` categories are always on. */
export interface NotificationPreference {
  readonly category: NotificationCategory;
  readonly inApp: boolean;
  readonly email: boolean;
  readonly locked: boolean;
}

/** Stored overrides: `category → channel → enabled`. Missing means on (the default). */
export type NotificationPreferenceOverrides = Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
>;

/** Every category with the user's effective settings (defaults on; mandatory locked on). */
export function resolvePreferences(overrides: NotificationPreferenceOverrides): NotificationPreference[] {
  return NOTIFICATION_CATEGORIES.map((category) => {
    const locked = isMandatoryCategory(category);
    const o = overrides[category] ?? {};
    return {
      category,
      inApp: locked || (o.in_app ?? true),
      email: locked || (o.email ?? true),
      locked,
    };
  });
}

/** Whether a notification must reach the user whatever their preferences. */
function isMandatory(event: string, severity: NotificationSeverity): boolean {
  const category = notificationCategory(event);
  return severity === 'critical' || (category !== null && isMandatoryCategory(category));
}

/**
 * Whether a notification shows in the user's bell and list. Events outside
 * the catalogue always show (they cannot be filtered by category).
 */
export function showsInApp(
  event: string,
  severity: NotificationSeverity,
  overrides: NotificationPreferenceOverrides,
): boolean {
  const category = notificationCategory(event);
  if (category === null || isMandatory(event, severity)) return true;
  return overrides[category]?.in_app ?? true;
}

/**
 * Whether a notification is emailed (requirement 20.2, 20.3): critical items
 * and mandatory categories always; `never` events otherwise not; everything
 * else unless the user turned that category's email off. Events outside the
 * catalogue are never emailed.
 */
export function shouldEmail(
  event: string,
  severity: NotificationSeverity,
  overrides: NotificationPreferenceOverrides,
): boolean {
  if (!isNotificationEvent(event)) return false;
  const def: NotificationEventDef = NOTIFICATION_EVENTS[event];
  if (severity === 'critical') return true;
  if (def.email === 'never') return false;
  if (isMandatory(event, severity)) return true;
  return overrides[def.category]?.email ?? true;
}

// ---------------------------------------------------------------------------
// Deep links (requirement 20.6)
// ---------------------------------------------------------------------------

export interface NotificationRef {
  readonly event: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly params: Readonly<Record<string, unknown>>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The SPA path a notification opens (relative to the app origin). */
export function notificationLink(ref: NotificationRef): string {
  const id = encodeURIComponent(ref.objectId);
  const category = notificationCategory(ref.event);
  switch (category) {
    case 'approvals':
      return ref.objectType === 'scenario' ? `/approvals?scenario=${id}` : '/approvals';
    case 'hiring':
      return '/plan/hiring';
    case 'data':
      return '/data/sources';
    case 'security':
      return '/profile';
    case 'rules': {
      const ruleSetId = str(ref.params.ruleSetId);
      return ruleSetId ? `/rules/${encodeURIComponent(ruleSetId)}/edit?version=${id}` : '/rules';
    }
    case 'roster':
      return ref.event === 'roster.published' || ref.event === 'shift.changed' || ref.event === 'staff_request.decided'
        ? '/my-roster'
        : '/plan/roster';
    case 'offers':
      return ref.event === 'offer.sent' ? '/my-roster' : '/plan/roster';
    case 'borrow':
      return '/plan/roster';
    case 'plans':
      return ref.event === 'scenario.published' ? '/plan/summary' : '/plan/network';
    case 'scenarios':
      return ref.objectType === 'scenario' ? `/scenarios/${id}/settings` : '/scenarios';
    case null:
      return ref.objectType === 'scenario' ? `/scenarios/${id}/settings` : '/notifications';
  }
}

// ---------------------------------------------------------------------------
// Wire contracts
// ---------------------------------------------------------------------------

/** SCR-040 filter tabs: everything, unread only, or a group of categories. */
export const NOTIFICATION_FILTERS = ['all', 'unread', 'approvals', 'plans', 'data', 'rules'] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

/** Categories each category tab covers ("Plans" includes scenarios and hiring). */
export const NOTIFICATION_FILTER_CATEGORIES: Readonly<
  Record<Exclude<NotificationFilter, 'all' | 'unread'>, readonly NotificationCategory[]>
> = {
  approvals: ['approvals'],
  plans: ['plans', 'scenarios', 'hiring'],
  data: ['data'],
  rules: ['rules'],
};

/** Notifications in the bell's dropdown (design.md: "the latest 5"). */
export const NOTIFICATION_BELL_LIMIT = 5;
/** Most notifications returned per page. */
export const NOTIFICATION_PAGE_MAX = 100;

export interface NotificationItem {
  readonly id: string;
  readonly event: string;
  readonly category: NotificationCategory | null;
  readonly severity: NotificationSeverity;
  readonly objectType: string;
  readonly objectId: string;
  /** Display name of the object (scenario name, rule set + version, …), when known. */
  readonly objectName: string | null;
  /** Message parameters; the text is rendered in the reader's language (requirement 20.5). */
  readonly params: Readonly<Record<string, unknown>>;
  /** SPA deep link (requirement 20.6). */
  readonly link: string;
  readonly createdAt: IsoDateTime;
  readonly readAt: IsoDateTime | null;
  /** Seeded demo data (P18). */
  readonly synthetic: boolean;
}

/** `GET /notifications` — the caller's own notifications only (P11). */
export interface NotificationListResponse {
  readonly items: readonly NotificationItem[];
  /** Unread notifications across every category the user sees in-app. */
  readonly unreadCount: number;
  /** Pass as `before` for the next page; `null` on the last page. */
  readonly nextBefore: IsoDateTime | null;
}

/** `POST /notifications/read-all` — how many were marked read. */
export interface MarkNotificationsReadResponse {
  readonly updated: number;
  readonly unreadCount: number;
}

/** `GET` / `PUT /notification-preferences`. */
export interface NotificationPreferencesResponse {
  readonly language: Language;
  readonly preferences: readonly NotificationPreference[];
}

export interface UpdateNotificationPreferencesRequest {
  readonly preferences: readonly {
    readonly category: NotificationCategory;
    readonly inApp?: boolean;
    readonly email?: boolean;
  }[];
}
