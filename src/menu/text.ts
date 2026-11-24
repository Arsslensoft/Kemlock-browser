// The menu's strings, from the browser's _locales (locales/parts/content.<lang>.json), never typed
// into the code. Substitutions fill the placeholders in the order they first appear in the string.

/** The message [name] in the browser's language; the name itself when there is none (tests, a typo). */
export function t(name: string, ...substitutions: (string | number)[]): string {
  const text = globalThis.chrome?.i18n?.getMessage?.(name, substitutions.map(String))
  return text || name
}
