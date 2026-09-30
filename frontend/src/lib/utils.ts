import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names, de-duplicating conflicting utilities.
 * Used by every shadcn/ui component copied into the repo (ADR-0003).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
