// What the extension's pages may ask about shared spaces (docs/plans/add-spaces.md): each request's arguments as a spec, in the
// shapes src/shared/messages.ts parses with, so a request is cut down to known fields of known sizes before any handler sees it.
// The spec builders are handed in by messages.ts, which keeps their private "bad" marker to itself.
import type { SpacePageKind } from './spaces-api'

type Parser = (value: unknown) => unknown
interface Field {
  parse: Parser
  optional: boolean
}

/** The small parsers of messages.ts that these specs are made of. */
export interface Builders {
  req: (parse: Parser) => Field
  opt: (parse: Parser) => Field
  text: (max: number, min?: number) => Parser
  bool: Parser
  nullable: (item: Parser) => Parser
  oneOf: (...allowed: string[]) => Parser
  /** An address of http or https. */
  address: Parser
}

/** An account, space or item id: a UUID or the 1 to 64 characters a WebDAV space's id is made of. */
const idLength = 128

export function spacePageSpecs(b: Builders): Record<SpacePageKind, Record<string, Field>> {
  const { req, opt, text, bool, nullable, oneOf } = b
  const id = text(idLength, 1)
  const roles = oneOf('owner', 'admin', 'member')
  const permissions = oneOf('view', 'view-hide-passwords', 'edit', 'edit-hide-passwords', 'manage')
  const kinds = oneOf('login', 'code', 'backupCodes', 'note', 'card', 'identity', 'key')
  return {
    spaces: { refresh: opt(bool) },
    space: { id: req(id) },
    spaceContact: { id: req(id), person: opt(id) },
    spaceTrust: { id: req(id), person: opt(id), digits: opt(text(120, 1)) },
    spaceAnswer: { id: req(id), accept: req(bool) },
    spaceMake: { name: req(text(120, 1)) },
    spaceLeave: { id: req(id) },
    spaceInvite: { id: req(id), email: req(text(320, 3)), role: req(roles) },
    spaceResend: { id: req(id), member: req(id) },
    spaceConfirm: { id: req(id), member: req(id), digits: req(text(120, 1)) },
    spaceRole: { id: req(id), member: req(id), role: req(roles) },
    spaceRemove: { id: req(id), member: req(id) },
    spaceGrant: {
      id: req(id),
      collection: req(id),
      member: req(id),
      permission: req(nullable(permissions)),
    },
    spaceHeld: { id: req(id) },
    spaceKeepHeld: { id: req(id), item: req(id) },
    spaceDeleteHeld: { id: req(id), item: req(id) },
    ownFingerprint: {},
    moveItem: { itemKind: req(kinds), id: req(id), space: req(nullable(id)), collection: opt(id) },
    syncSpaces: {},
    joinDavSpace: {
      invite: req(text(20_000, 1)),
      code: req(text(64, 1)),
      folder: req(b.address),
      username: req(text(1024)),
      password: req(text(4096)),
    },
    leaveDavSpace: { id: req(id) },
  }
}
