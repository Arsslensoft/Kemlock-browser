// How the account page (and the setup tab's account screens) ask the background: one `account` message with the op inside, answered with
// `Answer<T>` (src/shared/api.ts). A failure is an `AccountError` whose `code` is the one word the background or the core gave.
import type { AccountOp, AccountOps, AccountRequest, AccountResult } from '../shared/account'
import type { Answer, VaultState } from '../shared/api'

export class AccountError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'AccountError'
    this.code = code
  }
}

type ArgsOf<K extends AccountOp> = AccountOps[K]['args']

/** Asks for [op]; an op with no arguments takes none. */
export async function account<K extends AccountOp>(
  op: K,
  ...args: keyof ArgsOf<K> extends never ? [] : [ArgsOf<K>]
): Promise<AccountResult<K>> {
  const request = {
    op,
    ...(((args as unknown[])[0] as object | undefined) ?? {}),
  } as AccountRequest
  let answer: Answer<AccountResult<K>> | undefined
  try {
    answer = (await chrome.runtime.sendMessage({ kind: 'account', request })) as
      Answer<AccountResult<K>> | undefined
  } catch {
    throw new AccountError('failed')
  }
  if (answer === undefined || answer === null || typeof answer !== 'object' || !('ok' in answer))
    throw new AccountError('failed')
  if (!answer.ok) throw new AccountError(String(answer.error))
  return answer.value
}

/** The code of whatever was thrown: an AccountError's own, else `failed`. */
export function codeOf(error: unknown): string {
  return error instanceof AccountError ? error.code : 'failed'
}

/** Whether the vault is open, asked of the background and answered without starting anyone's idle time over. */
export async function vaultIsOpen(): Promise<boolean> {
  let answer: Answer<VaultState> | undefined
  try {
    answer = (await chrome.runtime.sendMessage({ kind: 'pageState' })) as
      Answer<VaultState> | undefined
  } catch {
    throw new AccountError('failed')
  }
  if (answer === undefined || answer === null || typeof answer !== 'object' || !('ok' in answer))
    throw new AccountError('failed')
  if (!answer.ok) throw new AccountError(String(answer.error))
  return answer.value.unlocked
}
