// Marking where two addresses differ, for the look-alike guard (spec "A look-alike site gets a
// guard"): what both share at the start and the end is plain, the middle of each is marked.

export interface Part {
  text: string
  /** The characters that differ. */
  marked: boolean
}

/** [a] and [b] cut into plain and marked parts, by code point: the shared start and end, and the middle. */
export function markDifference(a: string, b: string): { a: Part[]; b: Part[] } {
  const x = Array.from(a)
  const y = Array.from(b)
  let start = 0
  while (start < x.length && start < y.length && x[start] === y[start]) start++
  let end = 0
  while (
    end < x.length - start &&
    end < y.length - start &&
    x[x.length - 1 - end] === y[y.length - 1 - end]
  )
    end++
  const parts = (chars: string[]): Part[] => {
    const out: Part[] = [
      { text: chars.slice(0, start).join(''), marked: false },
      { text: chars.slice(start, chars.length - end).join(''), marked: true },
      { text: chars.slice(chars.length - end).join(''), marked: false },
    ]
    return out.filter((part) => part.text !== '')
  }
  return { a: parts(x), b: parts(y) }
}
