// What a frame holds that Kemlock may fill beyond sign-in and code fields: its card and identity fields (docs/plans/add-items.md),
// found by src/content/forms.ts, named as the other fields are, and registered so a fill later names one by this registry. A
// field the sign-in rules took stays a sign-in's, except a username in a frame with no password, which an address form's email may
// be, and a field the code or sign-in rules took as a code or a password becomes a card's security code when it plainly is one
// (a checkout's CVC in a password input is not a login's password).
import type { FieldElement, Geometry } from './dom'
import { readFormFields } from './formdom'
import { findFormFields } from './forms'
import type { Registered, Registry, Reported, Scan } from './scan'

export interface FormScan {
  reports: Reported[]
  registry: Registry
  /** Sign-in and code fields a card or identity field took: they are not those any more. */
  replaced: Set<string>
}

/** What the sign-in and code rules took, by the ids of the fields. */
export interface Claims {
  /** Sign-in fields a card or identity field may not take: a username beside a password. */
  taken: Set<string>
  /** Password and new-password fields: only a card's security code may take one. */
  passwords: Set<string>
  /** Code fields. */
  codes: Set<string>
  /** A username in a frame with no password: a form's email may be an identity's. */
  loose: Set<string>
  /** The field the sign-in rules guessed is the username beside a password: only a card's field may take it (a card number is not one). */
  guessed: Set<string>
}

/** Splits what [registry] holds into what the card and identity rules leave alone, and what they may take. */
export function claimsOf(registry: Registry, nameOf: (element: FieldElement) => string): Claims {
  const hasPassword = [...registry.values()].some(
    (entry) => entry.kind === 'password' || entry.kind === 'newPassword',
  )
  const claims: Claims = {
    guessed: new Set(),
    taken: new Set(),
    passwords: new Set(),
    codes: new Set(),
    loose: new Set(),
  }
  for (const entry of registry.values())
    for (const element of entry.elements) {
      const id = nameOf(element)
      if (entry.kind === 'code') claims.codes.add(id)
      else if (entry.kind === 'password' || entry.kind === 'newPassword') claims.passwords.add(id)
      else if (entry.kind === 'username') (hasPassword ? claims.guessed : claims.loose).add(id)
      else claims.taken.add(id)
    }
  return claims
}

/**
 * Reads the frame's card and identity fields. [claims] are what the other rules took; [nameOf] is the one name function of the
 * frame, so an element is the same field everywhere.
 */
export function scanForms(
  doc: Document,
  nameOf: (element: FieldElement) => string,
  geometry: Geometry | undefined,
  claims: Claims,
): FormScan {
  const { taken, codes, loose, passwords, guessed } = claims
  const elements = new Map<string, FieldElement>()
  const describe = (element: FieldElement) => {
    const id = nameOf(element)
    elements.set(id, element)
    return id
  }
  const descriptions = readFormFields(doc, describe, geometry)
  const found = findFormFields(descriptions, taken, guessed).filter(
    (field) => !(codes.has(field.id) || passwords.has(field.id)) || field.part === 'cardCsc',
  )
  const registry: Registry = new Map()
  const reports: Reported[] = []
  const replaced = new Set<string>()
  for (const field of found) {
    const element = elements.get(field.id)
    if (element === undefined) continue
    if (
      codes.has(field.id) ||
      loose.has(field.id) ||
      passwords.has(field.id) ||
      guessed.has(field.id)
    )
      replaced.add(field.id)
    const entry: Registered = {
      id: field.id,
      kind: field.kind,
      elements: [element],
      part: field.part,
      group: field.group,
      format: field.format,
    }
    registry.set(field.id, entry)
    reports.push({
      id: field.id,
      kind: field.kind,
      part: field.part,
      group: field.group,
      ...(field.format === '' ? {} : { rules: field.format }),
      ...(field.focused ? { focus: true } : {}),
    })
  }
  return { reports, registry, replaced }
}

/**
 * The sign-in and code fields [found] with the card and identity fields of the frame beside them: a field the sign-in rules took
 * stays theirs, a code field a card's security code took is that instead, and so is a password field that is one. When a security
 * code was the frame's only password, the username the sign-in rules found beside it was no sign-in's either, and is let go.
 */
export function withForms(
  found: Scan,
  doc: Document,
  nameOf: (element: FieldElement) => string,
  geometry: Geometry | undefined,
): Scan {
  const kept: Registry = new Map(found.registry)
  let forms = scanForms(doc, nameOf, geometry, claimsOf(kept, nameOf))
  const isPassword = (id: string) => {
    const kind = kept.get(id)?.kind
    return kind === 'password' || kind === 'newPassword'
  }
  const tookPassword = [...forms.replaced].some(isPassword)
  if (tookPassword) {
    for (const id of forms.replaced) kept.delete(id)
    const signIn = [...kept.keys()].some(isPassword)
    if (!signIn) for (const [id, entry] of kept) if (entry.kind === 'username') kept.delete(id)
    forms = scanForms(doc, nameOf, geometry, claimsOf(kept, nameOf))
  }
  const registry: Registry = new Map(kept)
  for (const id of forms.replaced) registry.delete(id)
  for (const [id, entry] of forms.registry) registry.set(id, entry)
  return {
    ...found,
    registry,
    reports: [
      ...found.reports.filter((report) => kept.has(report.id) && !forms.replaced.has(report.id)),
      ...forms.reports,
    ],
  }
}
