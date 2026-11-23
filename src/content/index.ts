// The content script, in every frame it is let into (design decision 3): it finds fields, places the
// button and the menu frame, fills, and watches forms being sent. It holds no item (decision 4).
// A classic script: the build bundles what it imports into one file.
import type { Answer, ContentApi } from '../shared/api'
import { Controller, type Call } from './controller'

const marker = Symbol.for('kemlock.content')

type Marked = typeof globalThis & { [marker]?: boolean }

/** A request to the background, whose answer is `{ ok, value }` or `{ ok: false, error }`. */
const call: Call = async (kind, args) => {
  const answer = (await chrome.runtime.sendMessage({ kind, ...(args as object) })) as
    Answer<Awaited<ReturnType<ContentApi[typeof kind]>>> | { ok: false; error: string } | undefined
  if (answer === undefined || !answer.ok) throw new Error(answer?.error ?? 'no answer')
  return answer.value as never
}

function start(): void {
  const scope = globalThis as Marked
  // Injected twice (registered, then by the popup's activeTab): the first stays
  if (scope[marker] === true) return
  scope[marker] = true
  const doc = document
  const label = chrome.i18n.getMessage('content_button_label') || 'Fill with Kemlock'
  const controller = new Controller({
    doc,
    call,
    pageUrl: chrome.runtime.getURL('src/menu/index.html'),
    // Chrome's frame address is a per-session one, but the frame's own origin is the extension's
    frameOrigin:
      __BROWSER__ === 'firefox'
        ? new URL(chrome.runtime.getURL('')).origin
        : `chrome-extension://${chrome.runtime.id}`,
    label,
    origin: window.origin || location.origin,
    isTop: window === window.top,
  })

  // The extension was reloaded or removed: the orphaned script lets go of the page
  const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      if (!chrome.runtime?.id) {
        controller.stop()
        return
      }
      fn(...args)
    }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false
    const reply = controller.handle(message)
    if (reply === undefined) return false
    Promise.resolve(reply).then(sendResponse, () => sendResponse({ ok: false }))
    return true
  })

  const options = { capture: true, passive: true } as const
  doc.addEventListener(
    'scroll',
    guard(() => controller.queuePlace()),
    options,
  )
  window.addEventListener(
    'resize',
    guard(() => controller.queuePlace()),
    options,
  )
  doc.addEventListener(
    'focusin',
    guard(() => controller.schedule()),
    options,
  )
  doc.addEventListener(
    'keydown',
    guard((event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') controller.arrowDown(event)
      else if (event.key === 'Escape' && controller.menuOpen) {
        controller.closeMenu(true)
      }
    }),
    true,
  )
  doc.addEventListener(
    'pointerdown',
    guard((event: PointerEvent) => {
      if (controller.menuOpen && !controller.isOwn(event.composedPath()))
        controller.closeMenu(false)
    }),
    options,
  )
  doc.addEventListener(
    'contextmenu',
    guard((event: MouseEvent) => controller.contextMenu(event)),
    options,
  )
  doc.addEventListener(
    'submit',
    guard((event: Event) => controller.submitted(event)),
    options,
  )
  doc.addEventListener(
    'click',
    guard((event: MouseEvent) => controller.pressedPage(event)),
    options,
  )
  window.addEventListener(
    'pagehide',
    guard(() => controller.navigated()),
  )
  window.addEventListener(
    'popstate',
    guard(() => controller.navigated()),
  )
  window.addEventListener(
    'hashchange',
    guard(() => controller.navigated()),
  )
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation
  navigation?.addEventListener(
    'navigate',
    guard(() => controller.navigated()),
  )

  const observer = new MutationObserver(
    guard((records: MutationRecord[]) => {
      if (records.every((record) => controller.ownMutation(record))) return
      controller.schedule()
    }),
  )
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'style',
      'class',
      'hidden',
      'disabled',
      'readonly',
      'type',
      'name',
      'id',
      'autocomplete',
      'maxlength',
      'aria-hidden',
      'aria-label',
    ],
  })
  // Fields in open shadow roots and layout the observer can't see
  setInterval(
    guard(() => {
      if (doc.visibilityState === 'visible') {
        controller.schedule()
        controller.queuePlace()
      }
    }),
    1500,
  )
  void controller.scan()
}

start()
