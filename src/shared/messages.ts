// The messages the extension's parts send each other (design decision 4).
// Each part's messages are parsed into fresh objects of known fields, so
// nothing a sender adds, like an address, reaches the background's
// handlers.

/** A field the content script found, by decision 7's rules. */
export type FieldKind = 'username' | 'password' | 'newPassword' | 'code'

export interface FieldReport {
  /** The content script's own name for the field, unique in its frame. */
  id: string
  kind: FieldKind
  /** For a code split across one-character boxes: how many (4 to 10). */
  boxes?: number
}

/**
 * What a content script may ask. It never names a site: the background
 * answers for the frame the browser says sent it.
 */
export type ContentMessage = { kind: 'fields'; fields: FieldReport[] } | { kind: 'suggestions' }

/** What only the extension's own pages may ask. */
export type PageMessage =
  { kind: 'state' } | { kind: 'lock' } | { kind: 'unlock'; password: string }

/** What the background sends one frame of a tab. */
export type ToContent = { kind: 'fill'; fieldId: string; value: string }

const fieldKinds: readonly FieldKind[] = ['username', 'password', 'newPassword', 'code']
const maxFields = 200
const maxIdLength = 64

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseField(raw: unknown): FieldReport | null {
  if (!isRecord(raw)) return null
  const { id, kind, boxes } = raw
  if (typeof id !== 'string' || id.length === 0 || id.length > maxIdLength) return null
  if (!fieldKinds.includes(kind as FieldKind)) return null
  if (boxes === undefined) return { id, kind: kind as FieldKind }
  if (
    kind !== 'code' ||
    !Number.isInteger(boxes) ||
    (boxes as number) < 4 ||
    (boxes as number) > 10
  )
    return null
  return { id, kind, boxes: boxes as number }
}

/** A content script's message, or null when it isn't one. */
export function parseContentMessage(raw: unknown): ContentMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'fields': {
      if (!Array.isArray(raw.fields) || raw.fields.length > maxFields) return null
      const fields = raw.fields.map(parseField)
      if (fields.some((field) => field === null)) return null
      const ids = new Set(fields.map((field) => field!.id))
      if (ids.size !== fields.length) return null
      return { kind: 'fields', fields: fields as FieldReport[] }
    }
    case 'suggestions':
      return { kind: 'suggestions' }
    default:
      return null
  }
}

/** An extension page's message, or null when it isn't one. */
export function parsePageMessage(raw: unknown): PageMessage | null {
  if (!isRecord(raw)) return null
  switch (raw.kind) {
    case 'state':
      return { kind: 'state' }
    case 'lock':
      return { kind: 'lock' }
    case 'unlock':
      return typeof raw.password === 'string' ? { kind: 'unlock', password: raw.password } : null
    default:
      return null
  }
}
