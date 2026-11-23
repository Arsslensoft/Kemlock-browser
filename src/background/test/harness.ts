// The background over a `FakeCore` and the chrome mock, for the tests: messages go through the real
// router, so a sender and a parser are in every test.
import { vi } from 'vitest'
import type { Answer } from '../../shared/api'
import { createBackground, type Background } from '../background'
import type { ClipboardBackend } from '../clipboard'
import { FakeCore, type FakeDisk } from '../core/fake'
import { route } from '../router'
import type { Identity } from '../senders'
import { installChromeMock, type ChromeMock } from './chrome-mock'

export const self: Identity = { id: 'kemlockid', origins: ['chrome-extension://kemlockid'] }
export const start = 1_800_000_000_000

const extension = (path: string, extra: Partial<chrome.runtime.MessageSender> = {}) => ({
  id: 'kemlockid',
  url: `chrome-extension://kemlockid${path}`,
  origin: 'chrome-extension://kemlockid',
  ...extra,
})

export const popup = extension('/src/popup/index.html')
export const setup = extension('/src/setup/index.html')
/** The menu frame, in frame 5 of tab 7. */
export const menuFrame = extension('/src/menu/index.html', {
  tab: { id: 7 } as chrome.tabs.Tab,
  frameId: 5,
})

/** A content script in a frame of a tab, at an address. */
export const content = (
  url: string,
  tabId = 7,
  frameId = 0,
  documentId = `doc-${tabId}-${frameId}`,
): chrome.runtime.MessageSender => ({
  id: 'kemlockid',
  url,
  origin: new URL(url).origin,
  tab: { id: tabId } as chrome.tabs.Tab,
  frameId,
  documentId,
})

/** A clipboard in memory. */
export class MemoryClipboard implements ClipboardBackend {
  text = ''
  writes: string[] = []
  write = async (text: string) => {
    this.text = text
    this.writes.push(text)
  }
  read = async () => this.text
}

export interface Harness {
  mock: ChromeMock
  core: FakeCore
  bg: Background
  clipboard: MemoryClipboard
  /** Sends a message from a sender through the router. */
  send<T = unknown>(message: unknown, sender?: chrome.runtime.MessageSender): Promise<Answer<T>>
  /** Sends and gives the value, failing the test on an error answer. */
  ok<T = unknown>(message: unknown, sender?: chrome.runtime.MessageSender): Promise<T>
  /** Starts a new background on the same disk and storage, as a stopped worker wakes. */
  restart(): Promise<Harness>
  done(): void
}

export interface HarnessOptions {
  /** An existing disk (a restart), else a vault with sample data, locked. */
  disk?: FakeDisk
  mock?: ChromeMock
  sample?: boolean
  /** Opens the vault with its password. */
  unlocked?: boolean
}

/** Fake time: the clock the background reads and the timers it sets are the test's. */
export function useClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(start)
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const mock = options.mock ?? installChromeMock()
  const core = new FakeCore({
    ...(options.disk === undefined ? {} : { disk: options.disk }),
    sample: options.sample ?? options.disk === undefined,
    now: () => Date.now(),
  })
  const clipboard = new MemoryClipboard()
  const bg = await createBackground(core, { now: () => Date.now(), clipboard })
  const h: Harness = {
    mock,
    core,
    bg,
    clipboard,
    send: (message, sender = popup) =>
      route(message, sender, self, bg.handlers) as Promise<Answer<never>>,
    ok: async (message, sender = popup) => {
      const answer = await route(message, sender, self, bg.handlers)
      if (!answer.ok) throw new Error(`answered ${answer.error} to ${JSON.stringify(message)}`)
      return answer.value as never
    },
    restart: () => harness({ disk: core.disk, mock, sample: false }),
    done: () => mock.uninstall(),
  }
  if (options.unlocked === true) await h.ok({ kind: 'unlock', password: 'correct horse' })
  return h
}

/** A frame of a tab reports its fields, as its content script does. */
export function report(
  h: Harness,
  url: string,
  fields: { id: string; kind: string; boxes?: number; rules?: string }[],
  tabId = 7,
  frameId = 0,
) {
  return h.ok<{ buttons: boolean }>({ kind: 'fields', fields }, content(url, tabId, frameId))
}
