// The background's one entry for messages: who sent it, whether that
// sender may send it, then its handler (design decision 4).
import type { Answer } from '../shared/api'
import {
  parseContentMessage,
  parsePageMessage,
  type ContentMessage,
  type PageMessage,
} from '../shared/messages'
import { errorWord } from './errors'
import { identifySender, type ContentSender, type Identity, type PageSender } from './senders'

type HandlerMap<M extends { kind: string }, S> = {
  [K in M['kind']]?: (message: Extract<M, { kind: K }>, sender: S) => unknown
}

export interface Handlers {
  content: HandlerMap<ContentMessage, ContentSender>
  page: HandlerMap<PageMessage, PageSender>
}

/** The kind of an error and nothing it says: the core's detail (the Dart type), else the error's name. */
function errorKind(error: unknown): string {
  const detail = (error as { detail?: unknown } | null)?.detail
  const named = typeof detail === 'string' ? detail : (error as { name?: unknown } | null)?.name
  return typeof named === 'string' && /^[\w$<>, ?.:-]{1,100}$/.test(named) ? named : 'unknown'
}

async function run<M extends { kind: string }, S>(
  handlers: HandlerMap<M, S>,
  message: M,
  sender: S,
): Promise<Answer<unknown>> {
  const handler = handlers[message.kind as M['kind']] as
    ((message: M, sender: S) => unknown) | undefined
  if (handler === undefined) return { ok: false, error: 'unsupported' }
  try {
    return { ok: true, value: await handler(message, sender) }
  } catch (error) {
    const word = errorWord(error)
    // What the background didn't expect is answered as 'failed'; its console says what it was, in the
    // message's kind, the code and the kind of error only: never an error's text, which can carry input
    if (word === 'failed')
      console.error(`Kemlock: ${String(message.kind)} failed`, word, errorKind(error))
    return { ok: false, error: word }
  }
}

/**
 * Messages that go from one extension page to another and are not the background's: the setup tab's
 * relay of a security key's answer, which setup listens for itself. The background neither answers
 * nor counts them as refused.
 */
const forOtherPages: ReadonlySet<unknown> = new Set(['securityKeyResult'])

export function isForOtherPages(raw: unknown): boolean {
  return (
    typeof raw === 'object' && raw !== null && forOtherPages.has((raw as { kind?: unknown }).kind)
  )
}

/**
 * Answers one message. A content script gets answers for its own frame
 * only, and may not send what only the extension's pages may.
 */
export async function route(
  raw: unknown,
  chromeSender: chrome.runtime.MessageSender,
  self: Identity,
  handlers: Handlers,
): Promise<Answer<unknown>> {
  const sender = identifySender(chromeSender, self)
  if (sender === null) return { ok: false, error: 'refused' }
  if (sender.from === 'content') {
    const message = parseContentMessage(raw)
    if (message !== null) return run(handlers.content, message, sender)
    return { ok: false, error: parsePageMessage(raw) !== null ? 'refused' : 'malformed' }
  }
  const message = parsePageMessage(raw)
  if (message !== null) return run(handlers.page, message, sender)
  return { ok: false, error: parseContentMessage(raw) !== null ? 'refused' : 'malformed' }
}
