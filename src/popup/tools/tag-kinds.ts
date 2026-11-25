// Which of Home's lists hold items the core tags (`setTags` accepts their kind), so that the tag button and the tag editor are offered
// only where tagging works. A list with no entry here has no tag button.
import type { ItemKind } from '../../shared/tools-api'

const kindOfList: Readonly<Record<string, ItemKind>> = {
  codes: 'code',
  logins: 'login',
  passkeys: 'passkey',
  notes: 'note',
  cards: 'card',
  identities: 'identity',
}

/** The kind of item Home's [list] holds when the core tags that kind, else undefined (the list has no tag button). */
export function taggableKind(list: string): ItemKind | undefined {
  return kindOfList[list]
}
