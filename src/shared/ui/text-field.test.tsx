// @vitest-environment jsdom
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TextField } from './components'

// Browsers give every element a `spellcheck` property, which is what Preact sets; jsdom has none, so it is given one here
beforeAll(() => {
  if (!('spellcheck' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'spellcheck', {
      configurable: true,
      writable: true,
      value: true,
    })
  }
})

afterEach(() => {
  document.body.replaceChildren()
})

async function mountField(multiline: boolean): Promise<HTMLElement> {
  const root = document.createElement('div')
  document.body.append(root)
  await act(() => {
    render(h(TextField, { label: 'Message', value: '', multiline, onInput: () => undefined }), root)
  })
  return root
}

describe('a multiline TextField', () => {
  it('keeps the browser’s spell checker, capitals and correction off its text', async () => {
    const area = (await mountField(true)).querySelector('textarea')!
    // Preact sets spellcheck as the element's property, which is what a browser reads (jsdom keeps no attribute for it)
    expect((area as HTMLTextAreaElement).spellcheck).toBe(false)
    expect(area.getAttribute('autocapitalize')).toBe('off')
    expect(area.getAttribute('autocorrect')).toBe('off')
  })

  it('is still a box with its label', async () => {
    const root = await mountField(false)
    expect(root.querySelector('input')?.spellcheck).toBe(false)
    expect(root.querySelector('label')?.textContent).toBe('Message')
  })
})
