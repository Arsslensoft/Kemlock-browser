// The move off Vaultwarden or WebDAV as a page follows it: the core runs the app's own steps and answers where they stand, and the page asks
// again while they run. A worker that stops mid-move leaves a record that says where the next run goes on, so "Try again" resumes.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { MoveResult, MoveStatus } from '../shared/account'
import { describe } from './errors'
import { account, codeOf } from './send'

/** How often a running move is asked about, in milliseconds. */
export const pollEvery = 1000

export interface MoveRun {
  status: MoveStatus | undefined
  /** The words of why the last call failed, or null. */
  error: string | null
  /** The code of the last failure, or null. */
  code: string | null
  busy: boolean
  start: (choice?: 'keep' | 'remove') => Promise<void>
  cancel: () => Promise<void>
  refresh: () => Promise<void>
}

export function useMove(): MoveRun {
  const [status, setStatus] = useState<MoveStatus | undefined>(undefined)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const refresh = useCallback(async () => {
    try {
      const next = await account('moveStatus')
      if (alive.current) setStatus(next)
    } catch (error) {
      if (alive.current) setCode(codeOf(error))
    }
  }, [])

  const call = useCallback(async (work: () => Promise<MoveStatus>) => {
    setBusy(true)
    setCode(null)
    try {
      const next = await work()
      if (alive.current) setStatus(next)
    } catch (error) {
      if (alive.current) setCode(codeOf(error))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While a move runs, the page asks where it stands
  const running = status?.running === true
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), pollEvery)
    return () => clearInterval(timer)
  }, [running, refresh])

  const start = useCallback(
    (choice?: 'keep' | 'remove') =>
      call(() => account('moveStart', choice === undefined ? {} : { choice })),
    [call],
  )
  const cancel = useCallback(() => call(() => account('moveCancel')), [call])
  return {
    status,
    error: code === null ? null : describe(code),
    code,
    busy,
    start,
    cancel,
    refresh,
  }
}

/** The kinds that moved, as "3 login, 2 otp": the names are the server's. */
export function movedCount(result: MoveResult | undefined): number {
  return Object.values(result?.moved ?? {}).reduce((sum, count) => sum + count, 0)
}

/** The problem a stopped move has, as the name its words are under: one the page has words for, or `other`. */
export function problemName(problem: string): string {
  return [
    'removals',
    'unreadable',
    'fileMissing',
    'checkFailed',
    'newer',
    'filesNeedPhone',
    'oldStoreGone',
    'editedMeanwhile',
    'network',
    'auth',
    'server',
    'signedOut',
    'sessionEnded',
    'older',
    'moveDone',
  ].includes(problem)
    ? problem
    : 'other'
}
