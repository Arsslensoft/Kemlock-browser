// Send links in text: finding one in what was pasted, the access the browser has to be asked for to reach its server, and a file's
// name as a name and not a path. A Send link is `https://<host>/#/send/<access id>/<key>` (docs/crypto.md "Sends"); the core reads
// it for real, strictly. This only finds the shape, to ask for the server's address before the core does.

// The access id is 22 characters, the key 43 (a Kemlock Send) or 22 (a Bitwarden one), and nothing of the key follows. The part before the
// `#` has none, so the first `#` is the one the core's own reading takes.
const linkShape =
  /https:\/\/[^\s<>"'()#]+#\/send\/[A-Za-z0-9_-]{22}\/(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/i

/** The first thing in [text] that has the shape of a Send link, or null. */
export function findSendLink(text: string): string | null {
  return linkShape.exec(text)?.[0] ?? null
}

/** The host permission opening [link] needs, `https://<host>/*` (a match pattern has no port), or null when it isn't an https link. */
export function originPatternOf(link: string): string | null {
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && url.hostname !== '' ? `https://${url.hostname}/*` : null
  } catch {
    return null
  }
}

/** The server the link names, with its port when it isn't https's own, for what the person is told. */
export function hostOfLink(link: string): string {
  try {
    return new URL(link).host
  } catch {
    return ''
  }
}

// Control characters, what a file system refuses, and the controls that make text read in another order than it is written
// eslint-disable-next-line no-control-regex
const unwanted = /[\u0000-\u001f\u007f<>:"|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/**
 * A name that is only a name: the sender chose it, so a path in it, a backslash, a control character or one a file system refuses are
 * taken out, and an empty one becomes "send".
 */
export function fileNameOnly(name: string): string {
  const bare = name.replace(unwanted, '').trim()
  const last = bare.split(/[\\/]/).pop() ?? ''
  const clean = last.replace(/\\/g, '').replace(/^\.+/, '').trim()
  return clean === '' ? 'send' : clean.slice(0, 200)
}
