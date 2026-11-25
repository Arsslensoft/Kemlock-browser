// Where the keys screens are: a stack of one page over the list, in the popup and in the keys tab.
export type Tool = 'encrypt' | 'decrypt' | 'sign' | 'verify'

export type KeysRoute =
  | { name: 'list'; tab?: 'keys' | 'contacts' }
  | { name: 'key'; id: string }
  | { name: 'addKey'; text?: string }
  | { name: 'contact'; id: string }
  | { name: 'addContact'; text?: string }
  | { name: 'tools'; tool?: Tool; keyId?: string }

const tools: readonly string[] = ['encrypt', 'decrypt', 'sign', 'verify']

/** A route as the keys tab's address says it: `#tools/encrypt`, `#addKey`, `#contacts`. */
export function routeFromHash(hash: string): KeysRoute {
  const [name, argument] = hash.replace(/^#/, '').split('/')
  switch (name) {
    case 'addKey':
      return { name: 'addKey' }
    case 'addContact':
      return { name: 'addContact' }
    case 'contacts':
      return { name: 'list', tab: 'contacts' }
    case 'tools':
      return argument !== undefined && tools.includes(argument)
        ? { name: 'tools', tool: argument as Tool }
        : { name: 'tools' }
    default:
      return { name: 'list' }
  }
}

/** The hash that opens a route in the keys tab. */
export function hashOf(route: KeysRoute): string {
  switch (route.name) {
    case 'addKey':
    case 'addContact':
      return route.name
    case 'tools':
      return route.tool === undefined ? 'tools' : `tools/${route.tool}`
    case 'list':
      return route.tab === 'contacts' ? 'contacts' : ''
    default:
      return ''
  }
}
