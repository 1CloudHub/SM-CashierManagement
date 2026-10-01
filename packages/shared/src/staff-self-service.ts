/**
 * Staff self-service — My roster, time-off and swap requests (task 18;
 * Requirement 15, 7.3/7.4; Property 11 Staff self-scope, Property 19
 * requests do not change the roster until approved).
 *
 * A Staff user sees only their own shifts, changes and rest days (P11): the
 * My roster payload carries no other cashier's name, shift or cost. They can
 * raise a **time-off request** (date range, optional reason and note) or a
 * **swap request** (give one of their shifts, take an open shift — or a
 * colleague's shift — at the same store). Each request goes to the store
 * manager of the affected store; the published roster does not change while
 * it is pending (P19). Approval applies it — time off as unavailability plus
 * the cashier's shifts in the range left open, a swap as ShiftOverrides —
 * under the same labor-rule rules as a manager's edit (warning needs a
 * reason, a missed 24-hour rest is never saved; Req 7.3/7.4).
 *
 * Also here: the client-side "Add to calendar" `.ics` builder.
 */
import type { IsoDate, IsoDateTime } from './entities.js';
import type { LocalShiftTimes, OverrideCheck, RosterActivity, ShiftOverrideRecordType, ValidationIssue } from './roster.js';
import { localToInstant } from './roster.js';

// ---------------------------------------------------------------------------
// My roster (SCR-025)
// ---------------------------------------------------------------------------

/** Longest My roster window, in days (four weeks). */
export const MY_ROSTER_MAX_DAYS = 28;

/** A shift time as the cashier last had it (for "changed from …"). */
export type ShiftTimes = LocalShiftTimes;

/** The latest change to one of the cashier's own shifts (✎). */
export interface MyShiftChange {
  readonly type: ShiftOverrideRecordType;
  /** Who changed it (a store manager, or the cashier themselves for an accepted offer). */
  readonly by: string;
  readonly at: IsoDateTime;
  /** The shift's times before the change, when they differ from now. */
  readonly previous: ShiftTimes | null;
}

/** One of the cashier's own scheduled shifts. */
export interface MyShiftDto extends LocalShiftTimes {
  readonly id: string;
  readonly storeId: string;
  readonly storeName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly activities: readonly RosterActivity[];
  readonly changed: MyShiftChange | null;
  /** A pending request of theirs that involves this shift (the roster is unchanged until it is decided, P19). */
  readonly pendingRequestId: string | null;
}

/** A shift that is no longer theirs (removed, reassigned, emergency off, approved time off). */
export interface MyRemovedShift extends LocalShiftTimes {
  readonly shiftId: string;
  readonly type: ShiftOverrideRecordType;
  readonly by: string;
  readonly at: IsoDateTime;
}

export type MyDayAbsence = 'rest' | 'unavailable';

export interface MyRosterDayDto {
  readonly date: IsoDate;
  readonly shifts: readonly MyShiftDto[];
  /** Why there is no shift: a rest day, or marked unavailable (approved time off, emergency off, …). */
  readonly absence: MyDayAbsence | null;
  /** Shifts on this day that were taken off them, with the change. */
  readonly removed: readonly MyRemovedShift[];
}

/** The cashier's own travel limit and cross-store setting (home-area consent, task 15). */
export interface MyTravelLimit {
  readonly maxTravelMin: number;
  readonly crossStoreOffers: boolean;
}

export interface MyRosterResponse {
  readonly staff: {
    readonly id: string;
    readonly employeeNo: string;
    readonly name: string;
    readonly storeName: string;
    readonly departmentName: string;
    readonly contract: 'FT' | 'PT' | 'FLOAT';
  };
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly days: readonly MyRosterDayDto[];
  /** Null when the cashier has not shared a home area (offers then come only from their own store). */
  readonly travelLimit: MyTravelLimit | null;
  /** Seeded demo data (P18). */
  readonly synthetic: boolean;
}

/**
 * P11 for an offer: within the cashier's own travel limit. Offers from their
 * own store always qualify; another store's offer needs cross-store offers on
 * and a travel time within the limit.
 */
export function offerWithinTravelLimit(
  offer: { readonly travelMin: number | null; readonly ownStore: boolean },
  limit: MyTravelLimit | null,
): boolean {
  if (offer.ownStore) return true;
  if (limit === null || !limit.crossStoreOffers) return false;
  return offer.travelMin !== null && offer.travelMin <= limit.maxTravelMin;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const STAFF_REQUEST_TYPES = ['time_off', 'swap'] as const;
export type StaffRequestType = (typeof STAFF_REQUEST_TYPES)[number];

export const STAFF_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'cancelled'] as const;
export type StaffRequestStatus = (typeof STAFF_REQUEST_STATUSES)[number];

export const TIME_OFF_REASONS = ['family', 'medical', 'personal', 'other'] as const;
export type TimeOffReason = (typeof TIME_OFF_REASONS)[number];

/** Longest time-off request, in days. */
export const MAX_TIME_OFF_DAYS = 31;
/** Longest free-text note or decision comment. */
export const MAX_REQUEST_NOTE = 500;

export type CreateStaffRequest =
  | {
      readonly type: 'time_off';
      readonly dateFrom: IsoDate;
      readonly dateTo: IsoDate;
      readonly reason?: TimeOffReason;
      readonly note?: string;
    }
  | {
      readonly type: 'swap';
      /** One of the cashier's own shifts. */
      readonly offeredShiftId: string;
      /** An open shift, or a colleague's shift, at the same store. */
      readonly targetShiftId: string;
      readonly note?: string;
    };

export interface StaffRequestDecision {
  readonly decision: 'approve' | 'decline';
  /** Required to approve a change that breaks a labor rule (warning; Req 7.3). */
  readonly reason?: string;
  /** Comment to the cashier (shown on a decline). */
  readonly note?: string;
}

export type Validated<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A real calendar date in `YYYY-MM-DD`. */
export function isCalendarDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Whole days from `from` to `to` inclusive (1 for the same day). */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function optionalText(value: Record<string, unknown>, key: string, issues: ValidationIssue[]): void {
  const v = value[key];
  if (v !== undefined && (typeof v !== 'string' || v.length > MAX_REQUEST_NOTE)) {
    issues.push({ path: key, message: `Use text of at most ${MAX_REQUEST_NOTE} characters.` });
  }
}

/**
 * Shape check of a `POST /me/requests` body (dependency-free, shared by the
 * API and the SPA's mock adapter). `today` is the cashier's local date: time
 * off cannot start in the past. Ownership, stores and labor rules are the
 * API's to check.
 */
export function validateCreateStaffRequest(value: unknown, today: IsoDate): Validated<CreateStaffRequest> {
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] };
  const issues: ValidationIssue[] = [];
  const type = value.type;
  if (type !== 'time_off' && type !== 'swap') {
    return { ok: false, issues: [{ path: 'type', message: `Use one of ${STAFF_REQUEST_TYPES.join(', ')}.` }] };
  }
  const allowed = type === 'time_off' ? ['type', 'dateFrom', 'dateTo', 'reason', 'note'] : ['type', 'offeredShiftId', 'targetShiftId', 'note'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({ path: key, message: 'Unknown field.' });
  optionalText(value, 'note', issues);
  if (type === 'time_off') {
    const { dateFrom, dateTo, reason } = value;
    if (!isCalendarDate(dateFrom)) issues.push({ path: 'dateFrom', message: 'Use a calendar date, e.g. 2026-12-24.' });
    else if (dateFrom < today) issues.push({ path: 'dateFrom', message: 'Time off can’t start in the past.' });
    if (!isCalendarDate(dateTo)) issues.push({ path: 'dateTo', message: 'Use a calendar date, e.g. 2026-12-24.' });
    if (isCalendarDate(dateFrom) && isCalendarDate(dateTo)) {
      if (dateTo < dateFrom) issues.push({ path: 'dateTo', message: 'The last day can’t be before the first.' });
      else if (daysInclusive(dateFrom, dateTo) > MAX_TIME_OFF_DAYS) {
        issues.push({ path: 'dateTo', message: `Ask for at most ${MAX_TIME_OFF_DAYS} days at a time.` });
      }
    }
    if (reason !== undefined && !(TIME_OFF_REASONS as readonly unknown[]).includes(reason)) {
      issues.push({ path: 'reason', message: `Use one of ${TIME_OFF_REASONS.join(', ')}.` });
    }
  } else {
    for (const key of ['offeredShiftId', 'targetShiftId'] as const) {
      const v = value[key];
      if (typeof v !== 'string' || v.trim().length === 0) issues.push({ path: key, message: 'Required.' });
    }
    if (typeof value.offeredShiftId === 'string' && value.offeredShiftId === value.targetShiftId) {
      issues.push({ path: 'targetShiftId', message: 'Pick a different shift to take.' });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as CreateStaffRequest };
}

/** Shape check of a manager's decision body. */
export function validateStaffRequestDecision(value: unknown): Validated<StaffRequestDecision> {
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'Expected an object.' }] };
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(value)) if (!['decision', 'reason', 'note'].includes(key)) issues.push({ path: key, message: 'Unknown field.' });
  if (value.decision !== 'approve' && value.decision !== 'decline') issues.push({ path: 'decision', message: 'Use approve or decline.' });
  optionalText(value, 'reason', issues);
  optionalText(value, 'note', issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: value as unknown as StaffRequestDecision };
}

/** A shift as a request shows it (no names). */
export interface RequestShiftDto extends LocalShiftTimes {
  readonly shiftId: string;
  readonly storeId: string;
  readonly departmentName: string;
}

/** What a swap takes: an open shift, or a colleague's (the Staff view never names the colleague, P11). */
export interface SwapTargetDto extends RequestShiftDto {
  readonly kind: 'open' | 'colleague';
}

/** A request as the cashier who raised it sees it. */
export interface MyStaffRequestDto {
  readonly id: string;
  readonly type: StaffRequestType;
  readonly status: StaffRequestStatus;
  readonly createdAt: IsoDateTime;
  readonly storeName: string;
  readonly dateFrom: IsoDate | null;
  readonly dateTo: IsoDate | null;
  readonly reason: TimeOffReason | null;
  readonly note: string | null;
  readonly offered: RequestShiftDto | null;
  readonly target: SwapTargetDto | null;
  readonly decidedAt: IsoDateTime | null;
  /** The manager's comment (declines). */
  readonly decisionNote: string | null;
}

export interface MyStaffRequestsResponse {
  readonly requests: readonly MyStaffRequestDto[];
}

export interface MyStaffRequestResponse {
  readonly request: MyStaffRequestDto;
}

/** What a cashier can swap: their own upcoming shifts and the open shifts they could take. */
export interface SwapOptionsResponse {
  readonly mine: readonly RequestShiftDto[];
  readonly open: readonly SwapTargetDto[];
}

/** A request as the store manager sees it on SCR-022 (their own store's staff). */
export interface StoreStaffRequestDto extends Omit<MyStaffRequestDto, 'target' | 'storeName'> {
  readonly staff: { readonly id: string; readonly employeeNo: string; readonly name: string };
  readonly target: (SwapTargetDto & { readonly staffName: string | null }) | null;
  readonly decidedBy: string | null;
  /** Pending swaps: the live labor-rule check of approving it now. */
  readonly check: OverrideCheck | null;
  /** Pending time off: the cashier's shifts in the range that approval leaves open. */
  readonly shiftsLeftOpen: number | null;
  /** Pending: the roster moved since the request (approve no longer applies; decline it). */
  readonly stale: boolean;
}

export interface StoreStaffRequestsResponse {
  readonly requests: readonly StoreStaffRequestDto[];
}

export interface StoreStaffRequestResponse {
  readonly request: StoreStaffRequestDto;
}

// ---------------------------------------------------------------------------
// Add to calendar (.ics, generated client-side)
// ---------------------------------------------------------------------------

export interface CalendarShift extends LocalShiftTimes {
  readonly id: string;
  /** e.g. "Main checkout lanes" */
  readonly title: string;
  /** e.g. "SM Supermarket – Quezon City" */
  readonly location: string;
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsInstant(iso: IsoDateTime): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Folds a content line at 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * An RFC 5545 calendar of the cashier's own shifts (UTC times, CRLF line
 * ends, stable UIDs so re-importing updates instead of duplicating).
 */
export function buildShiftCalendar(shifts: readonly CalendarShift[], options: { readonly name: string; readonly now: Date }): string {
  const stamp = icsInstant(options.now.toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SM Retail//LaneWise//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(options.name)}`];
  for (const s of [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.id.localeCompare(b.id))) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:shift-${s.id}@lanewise`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsInstant(localToInstant(s.date, s.startMin))}`,
      `DTEND:${icsInstant(localToInstant(s.date, s.endMin))}`,
      `SUMMARY:${icsText(s.title)}`,
      `LOCATION:${icsText(s.location)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
