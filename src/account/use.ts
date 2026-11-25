// A page's way of doing one thing at a time: a busy flag, and what failed in the page's words.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { describe } from './errors'
import { codeOf } from './send'

export interface Runner {
  busy: boolean
  /** What the last run failed with, in words, or null. */
  error: string | null
  /** The code of the last failure, for a page that answers one in its own way. */
  code: string | null
  /** Runs [work]; its answer, or undefined when it failed (the failure is in `error`). */
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>
  clear: () => void
}

export function useRunner(): Runner {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true)
    setCode(null)
    try {
      return await work()
    } catch (error) {
      if (alive.current) setCode(codeOf(error))
      return undefined
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])
  const clear = useCallback(() => setCode(null), [])
  return { busy, error: code === null ? null : describe(code), code, run, clear }
}
