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

/**
 * For the jsdom tests: animation frames as zero-delay timers, so Preact's effects (which it schedules on the next frame, with
 * a 100 ms fallback timer) fire at once, and `cancelAnimationFrame` exists wherever the environment lacks it. `flushFrames`
 * waits them out, so no timer outlives the test.
 */
export function frameStubs(): Record<string, unknown> {
  return {
    requestAnimationFrame: (callback: (time: number) => void) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  }
}

export const flushFrames = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((done) => setTimeout(done, 0))
}
