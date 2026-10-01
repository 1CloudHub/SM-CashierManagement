import { useEffect, useState } from 'react'
import { OFFER_EXPIRY_MINUTES, type ShiftOfferStatus } from '@lanewise/shared'
import type { StatusTone } from '@/components/ui'

/** The tone (with its icon) of each offer status — never colour alone. */
export const OFFER_TONE: Readonly<Record<ShiftOfferStatus, StatusTone>> = {
  sent: 'info',
  accepted: 'success',
  declined: 'neutral',
  expired: 'neutral',
  withdrawn: 'neutral',
}

/** The current time, re-read every 30 s so "expires in" counts down. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Whole minutes until `expiresAt` (0 once passed; never above the 30-minute expiry, even with a clock read just before sending). */
export const minutesLeft = (expiresAt: string, now: Date) =>
  Math.min(OFFER_EXPIRY_MINUTES, Math.max(0, Math.ceil((Date.parse(expiresAt) - now.getTime()) / 60_000)))
