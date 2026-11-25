// What a handler throws to say why it can't answer, in a word the pages know.

/** The words the background answers with when a request can't be served. */
export type ErrorCode =
  | 'refused'
  | 'malformed'
  | 'unsupported'
  | 'failed'
  /** The vault is locked. */
  | 'locked'
  /** There is no vault to open. */
  | 'noVault'
  /** The site in the frame isn't the item's (decision 4). */
  | 'noMatch'
  /** The frame, field or tab is not one the background knows. */
  | 'unknownField'
  | 'securityKey'
  /** A card or identity may fill that frame only after the person confirms it in the menu (items, decision 1). */
  | 'confirm'
  /** A card or identity won't fill an http page without that confirmation. */
  | 'insecure'
  /** The top frame could not vouch that the frame to fill is in plain view (a page may hide a frame it embeds). */
  | 'unverified'
  | 'noPermission'
  | 'cancelled'
  | 'badRequest'

export class BackgroundError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code)
    this.name = 'BackgroundError'
  }
}

/**
 * The word an error is answered with: a handler's own, or the core's when it names itself a
 * `KemlockError` (its message is then the word, e.g. `duplicate`), else just `failed`.
 */
export function errorWord(error: unknown): string {
  if (error instanceof BackgroundError) return error.code
  if (
    error instanceof Error &&
    error.name === 'KemlockError' &&
    /^[\w.-]{1,100}$/.test(error.message)
  )
    return error.message
  return 'failed'
}
