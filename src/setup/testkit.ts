// For the tests only: the browser's i18n over the locale files' texts, with `{name}` filled from the
// substitutions in the order the names first appear (as the build's placeholders do).

export function makeGetMessage(
  messages: Record<string, string>,
): (name: string, subs?: string[]) => string {
  return (name, subs = []) => {
    const text = messages[name]
    if (text === undefined) return ''
    const order: string[] = []
    return text.replace(/\{(\w+)\}/g, (_, key: string) => {
      let at = order.indexOf(key)
      if (at < 0) {
        order.push(key)
        at = order.length - 1
      }
      return subs[at] ?? ''
    })
  }
}
