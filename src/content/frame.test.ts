// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geometry } from './dom'
import { MenuFrame } from './frame'

const geometry: Geometry = {
  rect: () => ({ left: 100, top: 100, width: 320, height: 200 }),
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

let calls: string[]
let frame: MenuFrame | undefined

beforeEach(() => {
  vi.useFakeTimers()
  calls = []
  document.body.innerHTML = ''
  // jsdom has no popovers: the host records what it is told, and elements marked data-open are open
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      calls.push('show')
    },
    hidePopover(this: HTMLElement) {
      calls.push('hide')
    },
  })
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    selector: string,
  ) {
    return selector === ':popover-open' && this.hasAttribute('data-open')
  })
})

afterEach(() => {
  frame?.close(false)
  frame = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover
})

const openFrame = () =>
  new MenuFrame(
    { doc: document, geometry, pageUrl: 'chrome-extension://abc/menu.html', ownHosts: new Set() },
    {
      mode: 'menu',
      tabId: 1,
      frameId: 0,
      fieldId: 'f1',
      anchor: () => ({ left: 100, top: 100, width: 200, height: 30 }),
      onClose: () => {},
    },
  )

describe('keeping the menu last on the top layer', () => {
  it('shows the menu again when the page opens a popover after it, once per popover', () => {
    frame = openFrame()
    expect(calls).toEqual(['show'])
    vi.advanceTimersByTime(300)
    expect(calls).toEqual(['show'])
    const popover = document.createElement('div')
    popover.setAttribute('popover', 'manual')
    document.body.append(popover)
    popover.setAttribute('data-open', '')
    vi.advanceTimersByTime(150)
    expect(calls).toEqual(['show', 'hide', 'show'])
    vi.advanceTimersByTime(600)
    expect(calls).toEqual(['show', 'hide', 'show'])
    // Closed and opened again: after the menu once more
    popover.removeAttribute('data-open')
    vi.advanceTimersByTime(150)
    popover.setAttribute('data-open', '')
    vi.advanceTimersByTime(150)
    expect(calls).toEqual(['show', 'hide', 'show', 'hide', 'show'])
  })
})
