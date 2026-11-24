// Live codes: asked every second while the popup shows them, never kept beyond it.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { LiveCode } from '../shared/api'
import { ask } from './send'

/** A code on show: its digits, when it ends, and the next one in its last seconds. */
export interface LiveEntry {
  code: string
  expiresAt?: number
  next?: string
}

/** The last seconds of a code, when it turns to the warning colour and shows the next one. */
export const warnSeconds = 5

/** Whole seconds left of a code, rounded up; undefined for a counter code. */
export function secondsLeft(entry: LiveEntry, now: number): number | undefined {
  return entry.expiresAt === undefined
    ? undefined
    : Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))
}

export interface Live {
  entries: Record<string, LiveEntry>
  /** The time of the last answer, so every ring on the screen agrees. */
  now: number
  /** An HOTP code's next value, which stays until the popup closes. */
  hold: (id: string, code: LiveCode) => void
}

export function useLiveCodes(ids: string[]): Live {
  const [entries, setEntries] = useState<Record<string, LiveEntry>>({})
  const [now, setNow] = useState(() => Date.now())
  const held = useRef<Record<string, LiveCode>>({})
  const key = [...new Set(ids)].sort().join('\u0000')

  useEffect(() => {
    const wanted = key === '' ? [] : key.split('\u0000')
    if (wanted.length === 0) return
    let stopped = false
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        const live = await ask('liveCodes', { ids: wanted })
        const at = Date.now()
        const ending = live
          .filter(
            (code) => code.expiresAt !== undefined && code.expiresAt - at <= warnSeconds * 1000,
          )
          .map((code) => code.id)
        const upcoming = ending.length > 0 ? await ask('nextCodes', { ids: ending }) : []
        if (stopped) return
        const next: Record<string, LiveEntry> = {}
        for (const code of live) {
          const hold = held.current[code.id]
          const shown = hold ?? code
          next[code.id] = {
            code: shown.code,
            expiresAt: shown.expiresAt,
            next: upcoming.find((candidate) => candidate.id === code.id)?.code,
          }
        }
        setEntries(next)
        setNow(at)
      } catch {
        // The next tick asks again; a locked vault is noticed by ask() itself.
      } finally {
        running = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [key])

  const hold = useCallback((id: string, code: LiveCode) => {
    held.current[id] = code
    setEntries((previous) => ({
      ...previous,
      [id]: { code: code.code, expiresAt: code.expiresAt },
    }))
  }, [])

  return { entries, now, hold }
}
