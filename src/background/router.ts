// The background's one entry for messages: who sent it, whether that
// sender may send it, then its handler (design decision 4).
import {
  parseContentMessage,
  parsePageMessage,
  type ContentMessage,
  type PageMessage,
} from '../shared/messages'
import { identifySender, type ContentSender, type Identity, type PageSender } from './senders'

export type Answer =
  | { ok: true; value?: unknown }
  | { ok: false; error: 'refused' | 'malformed' | 'unsupported' | 'failed' }

type HandlerMap<M extends { kind: string }, S> = {
  [K in M['kind']]?: (message: Extract<M, { kind: K }>, sender: S) => unknown
}

export interface Handlers {
  content: HandlerMap<ContentMessage, ContentSender>
  page: HandlerMap<PageMessage, PageSender>
}

async function run<M extends { kind: string }, S>(
  handlers: HandlerMap<M, S>,
  message: M,
  sender: S,
): Promise<Answer> {
  const handler = handlers[message.kind as M['kind']] as
    ((message: M, sender: S) => unknown) | undefined
  if (handler === undefined) return { ok: false, error: 'unsupported' }
  try {
    return { ok: true, value: await handler(message, sender) }
  } catch {
    return { ok: false, error: 'failed' }
  }
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
): Promise<Answer> {
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
