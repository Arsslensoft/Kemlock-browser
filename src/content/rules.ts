// A site's password rules, from the new-password field and its confirmation (design decision 11):
// `passwordrules` as Apple's attribute states it, `minlength` and `maxlength`, and what a
// `pattern` plainly asks for. The result is the text GeneratorOptions.siteRules carries, in
// `passwordrules` syntax, which the core's PasswordRules reads.

/** The classes a pattern asks for: `[a-z]`, `[A-Z]`, `\d`, a symbol. */
interface Wants {
  lower: boolean
  upper: boolean
  digit: boolean
  special: boolean
}

const none = (): Wants => ({ lower: false, upper: false, digit: false, special: false })

function wantsOf(body: string): Wants {
  const wants = none()
  if (/a-z/.test(body)) wants.lower = true
  if (/A-Z/.test(body)) wants.upper = true
  if (/\\d|0-9/.test(body)) wants.digit = true
  if (/\\W|\[\^(?:\\w|a-zA-Z0-9|A-Za-z0-9)[^\]]*\]|\[[^\]\w\\]+\]/.test(body)) wants.special = true
  return wants
}

const names: (keyof Wants)[] = ['upper', 'lower', 'digit', 'special']

/** The rules a `pattern` plainly states: required classes from its look-aheads, and a length. */
export function rulesFromPattern(pattern: string): string[] {
  const out: string[] = []
  const required = none()
  for (const match of pattern.matchAll(/\(\?=([^)]*)\)/g)) {
    const wants = wantsOf(match[1])
    for (const name of names) if (wants[name]) required[name] = true
  }
  for (const name of names) if (required[name]) out.push(`required: ${name}`)
  const lengths = [...pattern.matchAll(/\{(\d*),(\d*)\}/g)].pop()
  if (lengths !== undefined) {
    const min = Number.parseInt(lengths[1], 10)
    const max = Number.parseInt(lengths[2], 10)
    if (min > 0) out.push(`minlength: ${min}`)
    if (max > 0) out.push(`maxlength: ${max}`)
  }
  return out
}

/** What the fields of one new-password form say, as passwordrules text; undefined when they say nothing. */
export function siteRulesOf(inputs: HTMLInputElement[]): string | undefined {
  const explicit = inputs
    .map((input) => input.getAttribute('passwordrules')?.trim() ?? '')
    .find((rules) => rules !== '')
  const parts: string[] = []
  if (explicit !== undefined) parts.push(explicit.replace(/;+\s*$/, ''))
  const squeezed = (explicit ?? '').toLowerCase().replace(/ /g, '')
  const has = (word: string) => squeezed.includes(word + ':')
  const minLengths = inputs.map((input) => input.minLength).filter((n) => n > 0)
  const maxLengths = inputs.map((input) => input.maxLength).filter((n) => n > 0)
  let hasMin = has('minlength')
  let hasMax = has('maxlength')
  if (!hasMin && minLengths.length > 0) {
    parts.push(`minlength: ${Math.max(...minLengths)}`)
    hasMin = true
  }
  if (!hasMax && maxLengths.length > 0) {
    parts.push(`maxlength: ${Math.min(...maxLengths)}`)
    hasMax = true
  }
  const pattern = inputs
    .map((input) => input.getAttribute('pattern'))
    .find((value) => value !== null && value !== '')
  if (pattern !== undefined && pattern !== null && !has('required') && !has('allowed')) {
    for (const rule of rulesFromPattern(pattern)) {
      if (rule.startsWith('minlength') && hasMin) continue
      if (rule.startsWith('maxlength') && hasMax) continue
      parts.push(rule)
    }
  }
  return parts.length > 0 ? parts.join('; ') : undefined
}
