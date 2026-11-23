// What a frame holds that Kemlock may fill: the fields found by the rules (decision 7), named, the
// elements behind each name, and the report the background gets. A fill later names a field by this
// registry, and only a field still in it, connected and visible, takes a value.

import type { FieldReport } from '../shared/messages'
import { readFields, type Geometry } from './dom'
import { findCodeFields, findLoginFields, type FieldDescription } from './fields'
import { siteRulesOf } from './rules'

/** A field the frame reported: its elements (several for a code in boxes), in order. */
export interface Registered {
  id: string
  /** `manual`: a field the person right-clicked, which no rule found. */
  kind: FieldReport['kind'] | 'manual'
  elements: HTMLInputElement[]
}

export type Registry = Map<string, Registered>

/** A field as reported: a new password also says the site's rules for it (decision 11). */
export type Reported = FieldReport & { rules?: string }

export interface Scan {
  reports: Reported[]
  registry: Registry
  /** The new-password fields' elements, in page order, for the site's rules. */
  newPasswords: HTMLInputElement[]
}

/**
 * Reads the frame. [nameOf] gives each input its stable name; the elements are remembered as the
 * names are asked for.
 */
export function scanFrame(
  doc: Document,
  nameOf: (input: HTMLInputElement) => string,
  geometry?: Geometry,
): Scan {
  const elements = new Map<string, HTMLInputElement>()
  const describe = (input: HTMLInputElement) => {
    const id = nameOf(input)
    elements.set(id, input)
    return id
  }
  const descriptions: FieldDescription[] = readFields(doc, describe, geometry)
  const codes = findCodeFields(descriptions)
  const login = findLoginFields(descriptions)
  const registry: Registry = new Map()
  const reports: Reported[] = []
  const rules = siteRulesOf(
    login.newPasswords
      .map((id) => elements.get(id))
      .filter((element): element is HTMLInputElement => element !== undefined),
  )

  const add = (id: string, kind: FieldReport['kind'], boxes?: string[]) => {
    const own = (boxes ?? [id]).map((name) => elements.get(name))
    if (own.some((element) => element === undefined)) return
    registry.set(id, { id, kind, elements: own as HTMLInputElement[] })
    const report: Reported = boxes === undefined ? { id, kind } : { id, kind, boxes: boxes.length }
    if (kind === 'newPassword' && rules !== undefined) report.rules = rules
    reports.push(report)
  }

  const isBoxes = codes.length > 0 && codes[0].character !== null
  const codeIds = new Set(codes.map((field) => field.id))
  // Page order, as the descriptions have it
  const wanted = new Map<string, FieldReport['kind']>()
  if (login.username !== null) wanted.set(login.username, 'username')
  if (login.password !== null) wanted.set(login.password, 'password')
  for (const id of login.newPasswords) wanted.set(id, 'newPassword')
  for (const description of descriptions) {
    if (codeIds.has(description.id)) {
      if (isBoxes) {
        if (description.id === codes[0].id)
          add(
            description.id,
            'code',
            codes.map((field) => field.id),
          )
      } else add(description.id, 'code')
      continue
    }
    const kind = wanted.get(description.id)
    if (kind !== undefined) add(description.id, kind)
  }
  return {
    reports,
    registry,
    newPasswords: login.newPasswords
      .map((id) => elements.get(id))
      .filter((element): element is HTMLInputElement => element !== undefined),
  }
}

/** A string that changes when the report does, so an unchanged frame says nothing again. */
export const signatureOfReports = (reports: Reported[]) =>
  reports.map((r) => `${r.id}:${r.kind}:${r.boxes ?? ''}:${r.rules ?? ''}`).join('|')
