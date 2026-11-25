// The clipboard through a page's editing commands, for a page that is never focused (Chrome's offscreen document, Safari's
// background page), where `navigator.clipboard` refuses. The page needs `clipboardWrite` (and `clipboardRead` to paste).

function withTextarea<T>(use: (area: HTMLTextAreaElement) => T): T {
  const area = document.createElement('textarea')
  document.body.append(area)
  try {
    return use(area)
  } finally {
    area.remove()
  }
}

/**
 * Copying an empty selection changes nothing (the old text stays), so clearing selects a placeholder
 * and the copy event swaps what it puts on the clipboard for an empty string: the clipboard ends
 * empty, not holding a space. Throws when the browser refuses.
 */
export function copyText(text: string): void {
  const clearing = text === ''
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', '')
    event.preventDefault()
  }
  if (clearing) document.addEventListener('copy', onCopy, true)
  try {
    const copied = withTextarea((area) => {
      area.value = clearing ? ' ' : text
      area.select()
      return document.execCommand('copy')
    })
    if (!copied) throw new Error('copy')
  } finally {
    if (clearing) document.removeEventListener('copy', onCopy, true)
  }
}

/** What the clipboard holds, by pasting into a textarea. Throws when the browser refuses. */
export function pasteText(): string {
  return withTextarea((area) => {
    area.focus()
    if (!document.execCommand('paste')) throw new Error('paste')
    return area.value
  })
}
