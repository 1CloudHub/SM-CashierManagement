/** SCR-010 greeting: time of day in store (Manila) time. */

// The greeting follows store (Manila) time, not the browser's time zone.
const MANILA_HOUR = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Manila' })

/** The hour of day (0–23) in Asia/Manila for an epoch-ms instant. */
export function manilaHour(now: number): number {
  const hour = MANILA_HOUR.formatToParts(now).find((part) => part.type === 'hour')
  return hour ? Number(hour.value) % 24 : 0
}

export function greetingKey(now: number): string {
  const h = manilaHour(now)
  return h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening'
}
