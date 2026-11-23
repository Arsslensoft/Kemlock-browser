// Where the popup is: a stack of one page over the home screen.

/** What a new login starts with, from a recently generated password. */
export interface Prefill {
  name: string
  password: string
  websites: string[]
}

export type Route =
  | { name: 'home' }
  | { name: 'login'; id: string }
  | { name: 'edit'; id: string | null; prefill?: Prefill }
  | { name: 'addCode' }
  | { name: 'health' }
  | { name: 'backupCodes' }
  | { name: 'generator' }
  | { name: 'recent' }
  | { name: 'settings' }
