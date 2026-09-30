/** Minimal UTC date arithmetic on ISO dates (YYYY-MM-DD). */
import type { IsoDate } from './privacy.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days since 1970-01-01 (UTC). */
export function dayNumber(date: IsoDate): number {
  if (!ISO_DATE.test(date)) throw new Error(`Invalid ISO date: ${date}`);
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid ISO date: ${date}`);
  return Math.round(ms / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

/** Day number of the Monday that starts the roster week containing `date`. */
export function mondayOf(date: IsoDate): number {
  return dayNumber(date) - ((dayOfWeek(date) + 6) % 7);
}
