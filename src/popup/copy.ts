// Copying goes through the background (design decision 14), which clears the clipboard later only
// if it still holds the value. The popup never keeps the value it copies, apart from a generated
// password it was handed to show.
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
}

/** A function that copies, and says so (or why not) at the foot of the page. */
export function useCopy(): (what: What, id: string, value?: string) => Promise<boolean> {
  const say = useToast()
  return async (what, id, value) => {
    try {
      await ask('copy', value === undefined ? { what, id } : { what, id, value })
      say(t(said[what]))
      return true
    } catch (error) {
      say(errorMessage(error))
      return false
    }
  }
}
