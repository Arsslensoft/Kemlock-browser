// What the files tab does, by the address's hash the popup opens it with: `#newFile`, `#replace/<file id>`, `#attach/<note id>`.

export type FilesRoute =
  | { name: 'newFile' }
  | { name: 'replace'; id: string }
  | { name: 'attach'; noteId: string }

// An entry's id: a UUID or the app's own (base64url), never longer than the core takes
const idPattern = '([A-Za-z0-9_.-]{1,100})'

/** The page [hash] names; a new file for any other hash. */
export function routeFromHash(hash: string): FilesRoute {
  const replace = new RegExp(`^#replace/${idPattern}$`).exec(hash)
  if (replace !== null) return { name: 'replace', id: replace[1]! }
  const attach = new RegExp(`^#attach/${idPattern}$`).exec(hash)
  if (attach !== null) return { name: 'attach', noteId: attach[1]! }
  return { name: 'newFile' }
}
