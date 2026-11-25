// Copying goes through the background (design decision 14), which clears the clipboard later only
// if it still holds the value. The popup never keeps the value it copies, apart from a generated
// password it was handed to show.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PageApi } from '../shared/api'
import { useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { ask } from './send'

type What = Parameters<PageApi['copy']>[0]['what']

const said: Record<What, string> = {
  username: 'popup_copiedUsername',
  password: 'popup_copiedPassword',
  code: 'popup_copiedCode',
  backupCode: 'popup_copiedBackupCode',
  generated: 'popup_copiedPassword',
  cardNumber: 'items_copiedCardNumber',
  cardCode: 'items_copiedCardCode',
  cardPin: 'items_copiedCardPin',
  cardholder: 'items_copiedCardholder',
  email: 'items_copiedEmail',
  phone: 'items_copiedPhone',
  documentNumber: 'items_copiedDocumentNumber',
  noteText: 'items_copiedNote',
}

/** The seconds the clipboard keeps what was copied (the setting), for the toast's second line. */
let clipboardSeconds = 30

export function rememberClipboardSeconds(seconds: number): void {
  clipboardSeconds = seconds
}

/** A function that copies, and says so (or why not) at the foot of the page. */
export function useCopy(): (
  what: What,
  id: string,
  value?: string,
  documentId?: string,
) => Promise<boolean> {
  const say = useToast()
  return async (what, id, value, documentId) => {
    try {
      await ask('copy', {
        what,
        id,
        ...(value === undefined ? {} : { value }),
        ...(documentId === undefined ? {} : { documentId }),
      })
      say(t(said[what]), t('popup_clipboardClears', clipboardSeconds))
      return true
    } catch (error) {
      say(errorMessage(error))
      return false
    }
  }
}

/** True for a moment after `flash()`: the "Copied" mark of a row. */
export function useFlash(ms = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = useCallback(() => {
    setOn(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOn(false), ms)
  }, [ms])
  return [on, flash]
}
