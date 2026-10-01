/** File-size formatting for FileInput (kept out of the component module for fast refresh). */

/** Bytes -> a locale-formatted size with the largest fitting unit (B, kB, MB, GB). */
export function formatFileSize(
  bytes: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = Math.max(0, bytes)
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return formatNumber(value, {
    style: 'unit',
    unit: units[i],
    unitDisplay: i === 0 ? 'long' : 'short',
    maximumFractionDigits: i === 0 ? 0 : 1,
  })
}
