// How long a modal passkey request may wait for the person, one rule for the page script and the background: what the page asked
// for, held between half a minute and ten minutes, and two minutes when it asked for nothing.
export const defaultTimeoutMs = 120_000
export const shortestTimeoutMs = 30_000
export const longestTimeoutMs = 600_000

export function modalTimeout(requested: number | undefined): number {
  return Math.min(longestTimeoutMs, Math.max(shortestTimeoutMs, requested ?? defaultTimeoutMs))
}
