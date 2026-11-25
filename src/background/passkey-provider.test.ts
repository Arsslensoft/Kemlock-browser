import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MenuView, PopupView } from '../shared/api'
import type {
  PasskeyCredentialJson,
  PasskeyOutcome,
  PasskeyPrompt,
  PasskeyStart,
  PasskeyView,
} from '../shared/passkeys'
import { content, harness, menuFrame, popup, report, type Harness } from './test/harness'
import {
  assertion,
  challenge,
  clientDataOf,
  creation,
  userHandle,
  verifies,
} from './test/passkey-kit'

const site = 'https://orbit-cloud.com/signin'
const origin = 'https://orbit-cloud.com'

let h: Harness
let counter = 0
const rid = () => (++counter).toString(16).padStart(32, '0')

/** What the tab says to a request for the card and a check that the frame is still there. */
const tabAnswers = (ping = true) => {
  h.mock.tabReply = (sent) => {
    const kind = (sent.message as { kind: string }).kind
    if (kind === 'passkeyPrompt') return { ok: true }
    if (kind === 'passkeyPing') return { ok: ping }
    return undefined
  }
}

beforeEach(async () => {
  h = await harness({ unlocked: true })
  h.mock.tabs.set(7, { id: 7, url: site, active: true, windowId: 1 })
  tabAnswers()
})
afterEach(() => h.done())

const begin = (
  over: Record<string, unknown> = {},
  sender: chrome.runtime.MessageSender = content(site),
) =>
  h.ok<PasskeyStart>(
    {
      kind: 'passkeyBegin',
      id: rid(),
      type: 'create',
      conditional: false,
      options: creation(),
      ...over,
    },
    sender,
  )

const cardRequests = () =>
  h.mock.sentToTabs.filter((sent) => (sent.message as { kind: string }).kind === 'passkeyPrompt')

interface Done {
  tabId: number
  message: { kind: 'passkeyDone'; id: string; result: PasskeyOutcome }
  options?: { frameId?: number; documentId?: string }
}
const ends = () =>
  h.mock.sentToTabs.filter(
    (sent) => (sent.message as { kind: string }).kind === 'passkeyDone',
  ) as unknown as Done[]
const endOf = (id: string) => ends().find((sent) => sent.message.id === id)

/** The secret of the newest card the top frame was asked for, which only its content script is told. */
const tokenOf = (): string => {
  const asked = cardRequests().at(-1)
  return (asked?.message as { token?: string } | undefined)?.token ?? 'no-card'
}
const card = (token = tokenOf(), sender = menuFrame) =>
  h.ok<PasskeyPrompt | null>({ kind: 'passkeyPrompt', tabId: 7, token }, sender)
const answer = (
  action: string,
  passkeyId?: string,
  sender: chrome.runtime.MessageSender = menuFrame,
  token = tokenOf(),
) =>
  h.send(
    {
      kind: 'passkeyAnswer',
      tabId: 7,
      token,
      action,
      ...(passkeyId === undefined ? {} : { passkeyId }),
    },
    sender,
  )
const closes = () =>
  h.mock.sentToTabs.filter((sent) => (sent.message as { kind: string }).kind === 'passkeyClose')
/** What the browser lists of a tab's frames, as webNavigation.getAllFrames gives them. */
const framesAre = (frames: { frameId: number; parentFrameId: number; url: string }[] | Error) => {
  // The frame list is an optional permission, held once the passkey switch was turned on
  h.mock.granted.add('webNavigation')
  ;(globalThis.chrome as unknown as { webNavigation: unknown }).webNavigation = {
    getAllFrames: async () => {
      if (frames instanceof Error) throw frames
      return frames
    },
  }
}
const answered = (action: string, passkeyId?: string) =>
  answer(action, passkeyId).then((result) => {
    if (!result.ok) throw new Error(`answered ${result.error}`)
  })

const credentialOf = (id: string): PasskeyCredentialJson => {
  const result = endOf(id)?.message.result
  if (result?.outcome !== 'credential') throw new Error(`ended as ${JSON.stringify(result)}`)
  return result.credential
}

describe('a creation', () => {
  it('is asked of the person in the top frame, and saved on their click', async () => {
    const id = rid()
    expect(await begin({ id })).toEqual({ outcome: 'pending' })
    expect(cardRequests()).toHaveLength(1)
    expect(cardRequests()[0]!.options).toEqual({ frameId: 0 })
    expect(await card()).toMatchObject({
      kind: 'create',
      site: 'orbit-cloud.com',
      rpName: 'Orbit Cloud',
      host: 'orbit-cloud.com',
      crossOrigin: false,
      user: { name: 'sam@example.com', displayName: 'Sam' },
      choices: [],
      state: { exists: true, unlocked: true },
    })
    // Nothing is made until the person chooses
    expect(await h.core.passkeys()).toEqual([])
    expect(endOf(id)).toBeUndefined()

    await answered('save')
    const [kept] = await h.core.passkeys()
    expect(kept).toMatchObject({ rpId: 'orbit-cloud.com', userName: 'sam@example.com' })
    const credential = credentialOf(id)
    expect(credential.id).toBe(kept!.credentialId)
    // To that frame and that document only
    expect(endOf(id)!.tabId).toBe(7)
    expect(endOf(id)!.options).toEqual({ frameId: 0, documentId: 'doc-7-0' })
    expect(clientDataOf(credential)).toEqual({
      type: 'webauthn.create',
      challenge,
      origin,
      crossOrigin: false,
    })
    // The card is over: a second click saves nothing more
    expect(await answer('save')).toEqual({ ok: false, error: 'unknownField' })
    expect(await h.core.passkeys()).toHaveLength(1)
    expect(await card()).toBeNull()
  })

  it('is left to the browser, with no card, when Kemlock can’t or shouldn’t serve it', async () => {
    const variants: [string, Record<string, unknown>, chrome.runtime.MessageSender?][] = [
      [
        'no ES256',
        { options: creation({ pubKeyCredParams: [{ type: 'public-key', alg: -257 }] }) },
      ],
      [
        'a security key only',
        {
          options: creation({
            authenticatorSelection: { authenticatorAttachment: 'cross-platform' },
          }),
        },
      ],
      ['PRF', { options: creation({ extensions: { prf: true } }) }],
      [
        'a relying party of another site',
        { options: creation({ rp: { id: 'evil.test', name: 'x' } }) },
      ],
      [
        'a relying party that is a public suffix',
        { options: creation({ rp: { id: 'com', name: 'x' } }) },
      ],
      ['a conditional creation', { conditional: true }],
      ['an insecure origin', {}, content('http://orbit-cloud.com/')],
      ['an origin that is none', {}, { ...content(site), origin: 'null' }],
      ['an address', {}, content('https://10.0.0.1/')],
    ]
    for (const [name, over, sender] of variants)
      expect(await begin(over, sender), name).toEqual({ outcome: 'fallback' })
    expect(cardRequests()).toHaveLength(0)
    expect(h.mock.session.has('kemlock_passkey_requests')).toBe(false)
  })

  it('is left to the browser when the provider is off, there is no vault, or the site is excluded', async () => {
    await h.ok({ kind: 'saveSettings', settings: { passkeys: false } })
    expect(await begin()).toEqual({ outcome: 'fallback' })
    await h.ok({ kind: 'saveSettings', settings: { passkeys: true } })
    expect(await begin()).toEqual({ outcome: 'pending' })
    await answered('cancel')

    await h.ok({ kind: 'passkeyHereSet', host: 'orbit-cloud.com', off: true })
    expect(await h.ok({ kind: 'passkeyHere', host: 'orbit-cloud.com' })).toBe(true)
    expect(await h.ok({ kind: 'passkeyHere', host: 'WWW.orbit-cloud.com' })).toBe(true)
    expect(await h.ok({ kind: 'passkeyHere', host: 'harbornotes.app' })).toBe(false)
    expect(await begin()).toEqual({ outcome: 'fallback' })
    await h.ok({ kind: 'passkeyHereSet', host: 'orbit-cloud.com', off: false })
    expect(await begin()).toEqual({ outcome: 'pending' })
  })

  it('is left to the browser when there is no vault', async () => {
    h.done()
    h = await harness({ sample: false })
    tabAnswers()
    expect(await begin()).toEqual({ outcome: 'fallback' })
    expect(cardRequests()).toHaveLength(0)
  })

  it('is left to the browser when the top frame can’t show the card', async () => {
    h.mock.tabReply = () => undefined
    expect(await begin()).toEqual({ outcome: 'fallback' })
    expect(h.mock.session.has('kemlock_passkey_requests')).toBe(false)
  })

  it('asks even when the vault holds a credential the site excludes, and tells the page only when the card is closed', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    const id = rid()
    const start = await begin({
      id,
      options: creation({ excludeCredentials: [{ type: 'public-key', id: made.response.id }] }),
    })
    // The page sees what it would see for a vault that holds none: a request that waits for the person
    expect(start).toEqual({ outcome: 'pending' })
    expect(cardRequests()).toHaveLength(1)
    expect(endOf(id)).toBeUndefined()
    expect(await card()).toMatchObject({ kind: 'create', alreadyHeld: true })
    // Saving is not what the card offers, and a click that says it is is not obeyed into a second passkey
    expect(await answer('save')).toMatchObject({ ok: true })
    expect(endOf(id)!.message.result).toEqual({ outcome: 'error', name: 'InvalidStateError' })
    expect(await h.core.passkeys()).toHaveLength(1)
  })

  it('tells the page the same of a held credential as of none, locked or not', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    await h.ok({ kind: 'lock' })
    const id = rid()
    const start = await begin({
      id,
      options: creation({ excludeCredentials: [{ type: 'public-key', id: made.response.id }] }),
    })
    expect(start).toEqual({ outcome: 'pending' })
    expect(await card()).toMatchObject({ kind: 'create', state: { unlocked: false } })
    expect((await card())!.alreadyHeld).toBeUndefined()
  })

  it('closes a card that says a credential is held with the page told it is already registered', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    const id = rid()
    await begin({
      id,
      options: creation({ excludeCredentials: [{ type: 'public-key', id: made.response.id }] }),
    })
    await answered('dismiss')
    expect(endOf(id)!.message.result).toEqual({ outcome: 'error', name: 'InvalidStateError' })
    // Dismissing a card that held nothing is a no, not an already-registered
    const plain = rid()
    await begin({ id: plain })
    await answered('dismiss')
    expect(endOf(plain)!.message.result).toEqual({ outcome: 'error', name: 'NotAllowedError' })
  })

  it('goes to the browser when the person chooses another device or key, or never here', async () => {
    const first = rid()
    await begin({ id: first })
    await answered('other')
    expect(endOf(first)!.message.result).toEqual({ outcome: 'fallback' })
    expect(await h.core.passkeys()).toEqual([])

    const second = rid()
    await begin({ id: second })
    await answered('never')
    expect(endOf(second)!.message.result).toEqual({ outcome: 'fallback' })
    // Kemlock stays out of that site's prompts from then on
    expect(await begin()).toEqual({ outcome: 'fallback' })
    expect(await h.core.passkeys()).toEqual([])
  })

  it('is not allowed when the person closes the card', async () => {
    const id = rid()
    await begin({ id })
    await answered('cancel')
    expect(endOf(id)!.message.result).toEqual({ outcome: 'error', name: 'NotAllowedError' })
    expect(await h.core.passkeys()).toEqual([])
  })

  it('asks the vault’s password first when it is locked, and saves after it opens', async () => {
    await h.ok({ kind: 'lock' })
    const id = rid()
    expect(await begin({ id })).toEqual({ outcome: 'pending' })
    expect(await card()).toMatchObject({ kind: 'create', state: { unlocked: false } })
    expect(await answer('save')).toEqual({ ok: false, error: 'locked' })
    expect(await h.send({ kind: 'unlock', password: 'correct horse' }, menuFrame)).toMatchObject({
      ok: true,
    })
    expect(await card()).toMatchObject({ state: { unlocked: true } })
    await answered('save')
    expect(credentialOf(id).id).toBe((await h.core.passkeys())[0]!.credentialId)
  })

  it('makes nothing when the frame that asked has gone', async () => {
    const id = rid()
    await begin({ id })
    tabAnswers(false)
    expect(await answer('save')).toEqual({ ok: false, error: 'unknownField' })
    expect(await h.core.passkeys()).toEqual([])
    expect(await card()).toBeNull()
  })

  it('ends the one before it, as only one card is asked at a time', async () => {
    const first = rid()
    const second = rid()
    await begin({ id: first })
    const stale = tokenOf()
    await begin({ id: second })
    expect(endOf(first)!.message.result).toEqual({ outcome: 'error', name: 'NotAllowedError' })
    expect(endOf(second)).toBeUndefined()
    // A click on the first card is not applied to the second request, which an embedded frame may have made meanwhile
    expect(await answer('save', undefined, menuFrame, stale)).toEqual({
      ok: false,
      error: 'unknownField',
    })
    expect(await card(stale)).toBeNull()
    expect(endOf(second)).toBeUndefined()
    expect(await h.core.passkeys()).toEqual([])
    await answered('save')
    expect(credentialOf(second).id).toBeTruthy()
  })

  it('is asked and answered only under the card’s own secret', async () => {
    const id = rid()
    await begin({ id })
    const token = tokenOf()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
    // A page framing the menu page itself has no secret to give
    for (const wrong of ['', 'nope', token.toUpperCase(), `${token}0`]) {
      if (wrong !== '') expect(await card(wrong), wrong).toBeNull()
      expect(await answer('save', undefined, menuFrame, wrong), wrong).toEqual({
        ok: false,
        error: wrong === '' ? 'malformed' : 'unknownField',
      })
    }
    expect(await h.core.passkeys()).toEqual([])
    expect(endOf(id)).toBeUndefined()
    // Two requests have two secrets
    const second = rid()
    await begin({ id: second })
    expect(tokenOf()).not.toBe(token)
  })

  it('does not give a conditional request a card, or a secret', async () => {
    await begin({ type: 'get', conditional: true, options: assertion() })
    expect(cardRequests()).toHaveLength(0)
    expect(await card('anything')).toBeNull()
  })

  it('is forgotten when the page aborts it, and its card closes', async () => {
    const id = rid()
    await begin({ id })
    // Another frame can't cancel it
    await h.ok({ kind: 'passkeyCancel', id }, content('https://orbit-cloud.com/x', 7, 3))
    expect(await card()).not.toBeNull()
    await h.ok({ kind: 'passkeyCancel', id }, content(site))
    expect(await card()).toBeNull()
    // Its own card closes, by its own secret, and no other menu or prompt of the page
    expect(closes()).toHaveLength(1)
    expect(closes()[0]!.message).toEqual({ kind: 'passkeyClose', token: tokenOf() })
    expect(closes()[0]!.options).toEqual({ frameId: 0 })
    expect(
      h.mock.sentToTabs.some((sent) => (sent.message as { kind: string }).kind === 'closeMenus'),
    ).toBe(false)
  })

  it('ends with the browser’s own way when its document is gone, and its card closes', async () => {
    const id = rid()
    await begin({ id })
    const token = tokenOf()
    // The document went on to another page: nothing waits for it any more
    tabAnswers(false)
    await h.bg.onTabUpdated(7, { status: 'loading', url: 'https://harbornotes.app/' })
    expect(await card(token)).toBeNull()
    expect(endOf(id)!.message.result).toEqual({ outcome: 'fallback' })
    expect(endOf(id)!.options).toEqual({ frameId: 0, documentId: 'doc-7-0' })
    expect(closes().map((sent) => sent.message)).toContainEqual({ kind: 'passkeyClose', token })
  })

  it('stays when the page only changed its address, as a single-page site does', async () => {
    const id = rid()
    await begin({ id })
    await h.bg.onTabUpdated(7, { status: 'loading', url: 'https://orbit-cloud.com/other' })
    await h.bg.onTabUpdated(7, { status: 'complete' })
    expect(await card()).not.toBeNull()
    expect(endOf(id)).toBeUndefined()
    await answered('save')
    expect(credentialOf(id).id).toBeTruthy()
  })

  it('ends with the browser’s own way when its tab closes', async () => {
    const id = rid()
    await begin({ id })
    const token = tokenOf()
    await h.bg.onTabRemoved(7)
    expect(await card(token)).toBeNull()
    expect(endOf(id)!.message.result).toEqual({ outcome: 'fallback' })
    expect(closes()).toHaveLength(1)
  })

  it('ends with the browser’s own way when the vault locks, and its card closes', async () => {
    const modal = rid()
    await begin({ id: modal })
    const conditional = rid()
    await begin({ id: conditional, type: 'get', conditional: true, options: assertion() })
    await h.ok({ kind: 'lock' })
    expect(endOf(modal)!.message.result).toEqual({ outcome: 'fallback' })
    expect(endOf(conditional)!.message.result).toEqual({ outcome: 'fallback' })
    expect(closes()).toHaveLength(1)
    expect(h.mock.session.has('kemlock_passkey_requests')).toBe(false)
  })

  it('names the top origin when a frame of another site asks, and answers that frame', async () => {
    framesAre([
      { frameId: 0, parentFrameId: -1, url: site },
      { frameId: 3, parentFrameId: 0, url: 'https://pay.example.net/embed' },
    ])
    const frame = content('https://pay.example.net/embed', 7, 3)
    const id = rid()
    await begin({ id, options: creation({ rp: { id: 'pay.example.net', name: 'Pay' } }) }, frame)
    expect(await card()).toMatchObject({
      site: 'pay.example.net',
      host: 'pay.example.net',
      crossOrigin: true,
    })
    // The card is the top frame's, whichever frame asked
    expect(cardRequests()[0]!.options).toEqual({ frameId: 0 })
    await answered('save')
    expect(endOf(id)!.options).toEqual({ frameId: 3, documentId: 'doc-7-3' })
    expect(clientDataOf(credentialOf(id))).toEqual({
      type: 'webauthn.create',
      challenge,
      origin: 'https://pay.example.net',
      crossOrigin: true,
      topOrigin: origin,
    })
  })

  it('goes to the browser from a frame that is not the top one when webNavigation is not held, and is served at the top', async () => {
    framesAre([
      { frameId: 0, parentFrameId: -1, url: site },
      { frameId: 3, parentFrameId: 0, url: 'https://pay.example.net/embed' },
    ])
    h.mock.granted.delete('webNavigation')
    const frame = content('https://pay.example.net/embed', 7, 3)
    expect(
      await begin({ options: creation({ rp: { id: 'pay.example.net', name: 'Pay' } }) }, frame),
    ).toEqual({ outcome: 'fallback' })
    expect(cardRequests()).toHaveLength(0)
    // The top frame is cross-origin with nothing, so it needs no frame list
    expect(await begin()).toEqual({ outcome: 'pending' })
    expect(await card()).toMatchObject({ crossOrigin: false })
  })

  it('is cross-origin when any ancestor is of another site, though the top is its own', async () => {
    framesAre([
      { frameId: 0, parentFrameId: -1, url: site },
      { frameId: 1, parentFrameId: 0, url: 'https://evil.test/ad' },
      { frameId: 2, parentFrameId: 1, url: 'https://orbit-cloud.com/embedded' },
    ])
    const id = rid()
    await begin({ id }, content('https://orbit-cloud.com/embedded', 7, 2))
    expect(await card()).toMatchObject({ crossOrigin: true })
    await answered('save')
    expect(clientDataOf(credentialOf(id))).toMatchObject({ crossOrigin: true, topOrigin: origin })
  })

  it('is not cross-origin when every ancestor is of its own site', async () => {
    framesAre([
      { frameId: 0, parentFrameId: -1, url: site },
      { frameId: 1, parentFrameId: 0, url: 'https://orbit-cloud.com/a' },
      { frameId: 2, parentFrameId: 1, url: 'https://orbit-cloud.com/b' },
    ])
    const id = rid()
    await begin({ id }, content('https://orbit-cloud.com/b', 7, 2))
    expect(await card()).toMatchObject({ crossOrigin: false })
    await answered('save')
    expect(clientDataOf(credentialOf(id))).toEqual({
      type: 'webauthn.create',
      challenge,
      origin,
      crossOrigin: false,
    })
  })

  it('goes to the browser when the ancestors can’t be read', async () => {
    const frame = content('https://orbit-cloud.com/b', 7, 2)
    // The top is a file, or a page with no web address
    framesAre([
      { frameId: 0, parentFrameId: -1, url: 'file:///tmp/top.html' },
      { frameId: 2, parentFrameId: 0, url: 'https://orbit-cloud.com/b' },
    ])
    expect(await begin({}, frame)).toEqual({ outcome: 'fallback' })
    framesAre([
      { frameId: 0, parentFrameId: -1, url: site },
      { frameId: 1, parentFrameId: 0, url: 'about:blank' },
      { frameId: 2, parentFrameId: 1, url: 'https://orbit-cloud.com/b' },
    ])
    expect(await begin({}, frame)).toEqual({ outcome: 'fallback' })
    // A frame the browser doesn't list, a parent it doesn't list, or no answer at all
    framesAre([{ frameId: 0, parentFrameId: -1, url: site }])
    expect(await begin({}, frame)).toEqual({ outcome: 'fallback' })
    framesAre([{ frameId: 2, parentFrameId: 1, url: 'https://orbit-cloud.com/b' }])
    expect(await begin({}, frame)).toEqual({ outcome: 'fallback' })
    framesAre(new Error('no permission'))
    expect(await begin({}, frame)).toEqual({ outcome: 'fallback' })
    expect(cardRequests()).toHaveLength(0)
  })
})

describe('a sign-in', () => {
  const made = async (name = 'sam@example.com', url = origin, rp = 'orbit-cloud.com') =>
    h.core.createPasskey(
      creation({
        rp: { id: rp, name: rp === 'orbit-cloud.com' ? 'Orbit Cloud' : 'Harbor' },
        user: { id: userHandle, name, displayName: name.split('@')[0] },
      }),
      url,
    )

  it('offers the site’s passkeys and signs with the one the person picks', async () => {
    const sam = await made()
    const alex = await made('alex@example.com')
    await made('sam@harbor.test', 'https://harbornotes.app', 'harbornotes.app')
    const id = rid()
    expect(await begin({ id, type: 'get', options: assertion() })).toEqual({ outcome: 'pending' })
    const prompt = await card()
    expect(prompt).toMatchObject({ kind: 'get', site: 'orbit-cloud.com' })
    expect(prompt!.choices).toEqual([
      { id: sam.passkeyId, name: 'Orbit Cloud', detail: 'sam' },
      { id: alex.passkeyId, name: 'Orbit Cloud', detail: 'alex' },
    ])
    await answered('use', alex.passkeyId)
    const credential = credentialOf(id)
    expect(credential.id).toBe(alex.response.id)
    expect(await verifies(String(alex.response.response.publicKey), credential)).toBe(true)
    expect(clientDataOf(credential)).toMatchObject({ type: 'webauthn.get', challenge, origin })
    expect(endOf(id)!.options).toEqual({ frameId: 0, documentId: 'doc-7-0' })
  })

  it('takes only a passkey the card offered', async () => {
    const sam = await made()
    const harbor = await made('sam@harbor.test', 'https://harbornotes.app', 'harbornotes.app')
    const id = rid()
    await begin({ id, type: 'get', options: assertion() })
    expect(await answer('use', harbor.passkeyId)).toEqual({ ok: false, error: 'refused' })
    expect(await answer('use', 'nope')).toEqual({ ok: false, error: 'refused' })
    expect(await answer('use')).toEqual({ ok: false, error: 'refused' })
    expect(endOf(id)).toBeUndefined()
    await answered('use', sam.passkeyId)
    expect(credentialOf(id).id).toBe(sam.response.id)
  })

  it('narrows the passkeys by the credentials the site allows', async () => {
    await made()
    const alex = await made('alex@example.com')
    await begin({
      type: 'get',
      options: assertion({ allowCredentials: [{ type: 'public-key', id: alex.response.id }] }),
    })
    expect((await card())!.choices.map((choice) => choice.id)).toEqual([alex.passkeyId])
  })

  it('goes to the browser at once when the vault holds none for the site', async () => {
    await made('sam@harbor.test', 'https://harbornotes.app', 'harbornotes.app')
    expect(await begin({ type: 'get', options: assertion() })).toEqual({ outcome: 'fallback' })
    expect(await begin({ type: 'get', options: assertion({ extensions: { prf: true } }) })).toEqual(
      { outcome: 'fallback' },
    )
    expect(cardRequests()).toHaveLength(0)
  })

  it('asks to unlock first, then shows the passkeys, or hands the request over when there are none', async () => {
    const sam = await made()
    await h.ok({ kind: 'lock' })
    const id = rid()
    // Locked, nothing says whether the site has one: the person is asked
    expect(await begin({ id, type: 'get', options: assertion() })).toEqual({ outcome: 'pending' })
    expect(await card()).toMatchObject({ kind: 'get', state: { unlocked: false }, choices: [] })
    await h.ok({ kind: 'unlock', password: 'correct horse' }, menuFrame)
    expect((await card())!.choices.map((choice) => choice.id)).toEqual([sam.passkeyId])
    await answered('cancel')

    // For a site with none, the card is over as soon as the vault opens, and the browser takes it
    await h.ok({ kind: 'lock' })
    const other = rid()
    await begin(
      {
        id: other,
        type: 'get',
        options: assertion({ rpId: 'harbornotes.app' }),
      },
      content('https://harbornotes.app/signin'),
    )
    await h.ok({ kind: 'unlock', password: 'correct horse' }, menuFrame)
    expect(await card()).toBeNull()
    expect(endOf(other)!.message.result).toEqual({ outcome: 'fallback' })
  })
})

describe('a conditional sign-in', () => {
  const fields = [{ id: 'u', kind: 'username' }]
  const open = async (fieldId = 'u') => {
    await report(h, site, fields)
    await h.ok({ kind: 'openMenu', fieldId }, content(site))
    return h.ok<MenuView>({ kind: 'menu', tabId: 7, frameId: 0, fieldId }, menuFrame)
  }

  it('shows no card, lists the passkeys in the field’s menu, and is answered from it', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    const id = rid()
    expect(await begin({ id, type: 'get', conditional: true, options: assertion() })).toEqual({
      outcome: 'pending',
    })
    expect(cardRequests()).toHaveLength(0)
    const view = await open()
    expect(view.passkeys).toEqual([{ id: made.passkeyId, name: 'Orbit Cloud', detail: 'Sam' }])
    await h.ok(
      { kind: 'passkeyChoose', tabId: 7, frameId: 0, fieldId: 'u', passkeyId: made.passkeyId },
      menuFrame,
    )
    expect(await verifies(String(made.response.response.publicKey), credentialOf(id))).toBe(true)
    // The request is over: the menu lists none, and a second pick is nothing
    expect((await open()).passkeys).toBeUndefined()
    expect(
      await h.send(
        { kind: 'passkeyChoose', tabId: 7, frameId: 0, fieldId: 'u', passkeyId: made.passkeyId },
        menuFrame,
      ),
    ).toEqual({ ok: false, error: 'unknownField' })
  })

  it('is kept whether the vault holds a passkey for the site or none, so a page learns nothing from it', async () => {
    // None for the site: the same answer as with one
    expect(await begin({ type: 'get', conditional: true, options: assertion() })).toEqual({
      outcome: 'pending',
    })
    await h.core.createPasskey(
      creation({ rp: { id: 'harbornotes.app', name: 'Harbor' } }),
      'https://harbornotes.app',
    )
    expect(await begin({ type: 'get', conditional: true, options: assertion() })).toEqual({
      outcome: 'pending',
    })
    await h.core.createPasskey(creation(), origin)
    expect(await begin({ type: 'get', conditional: true, options: assertion() })).toEqual({
      outcome: 'pending',
    })
    // A locked vault answers the same
    await h.ok({ kind: 'lock' })
    expect(await begin({ type: 'get', conditional: true, options: assertion() })).toEqual({
      outcome: 'pending',
    })
    expect(cardRequests()).toHaveLength(0)
  })

  it('lists nothing without a request of that frame, in a code field, or while locked', async () => {
    await h.core.createPasskey(creation(), origin)
    expect((await open()).passkeys).toBeUndefined()
    await h.ok({ kind: 'lock' })
    await begin({ type: 'get', conditional: true, options: assertion() })
    await h.ok({ kind: 'openMenu', fieldId: 'u' }, content(site))
    const locked = await h.ok<MenuView>(
      { kind: 'menu', tabId: 7, frameId: 0, fieldId: 'u' },
      menuFrame,
    )
    expect(locked.passkeys).toBeUndefined()
    await h.ok({ kind: 'unlock', password: 'correct horse' }, menuFrame)
    expect((await open()).passkeys).toHaveLength(1)
    await report(h, site, [
      { id: 'u', kind: 'username' },
      { id: 'c', kind: 'code' },
    ])
    await h.ok({ kind: 'openMenu', fieldId: 'c' }, content(site))
    const code = await h.ok<MenuView>(
      { kind: 'menu', tabId: 7, frameId: 0, fieldId: 'c' },
      menuFrame,
    )
    expect(code.passkeys).toBeUndefined()
  })

  it('can only be answered from a menu the frame opened', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    await begin({ type: 'get', conditional: true, options: assertion() })
    const choose = {
      kind: 'passkeyChoose',
      tabId: 7,
      frameId: 0,
      fieldId: 'u',
      passkeyId: made.passkeyId,
    }
    // No menu was opened: no grant
    expect(await h.send(choose, menuFrame)).toEqual({ ok: false, error: 'refused' })
    await report(h, site, fields)
    expect(await h.send(choose, menuFrame)).toEqual({ ok: false, error: 'refused' })
    expect(await h.send(choose, popup)).toEqual({ ok: false, error: 'refused' })
    await h.ok({ kind: 'openMenu', fieldId: 'u' }, content(site))
    expect(await h.send(choose, menuFrame)).toMatchObject({ ok: true })
  })
})

describe('who may answer', () => {
  it('is the menu frame of the tab the request is in, and no one else', async () => {
    await begin()
    const other = { ...menuFrame, tab: { id: 9 } as chrome.tabs.Tab } as typeof menuFrame
    expect(await answer('save', undefined, popup)).toEqual({ ok: false, error: 'refused' })
    expect(await answer('save', undefined, content(site))).toEqual({ ok: false, error: 'refused' })
    expect(await answer('save', undefined, other)).toEqual({ ok: false, error: 'refused' })
    const token = tokenOf()
    expect(await h.send({ kind: 'passkeyPrompt', tabId: 7, token }, popup)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(await h.send({ kind: 'passkeyPrompt', tabId: 7, token }, other)).toEqual({
      ok: false,
      error: 'refused',
    })
    expect(await h.core.passkeys()).toEqual([])
  })

  it('holds the page’s request to the sender’s frame, not to what it says', async () => {
    // A request that names another origin than the frame's is read at the frame's: nothing in it says where it is from
    const forged = {
      kind: 'passkeyBegin',
      id: rid(),
      type: 'create',
      conditional: false,
      options: creation({ rp: { id: 'harbornotes.app', name: 'Harbor' } }),
      origin: 'https://harbornotes.app',
    }
    expect(await h.ok(forged, content(site))).toEqual({ outcome: 'fallback' })
  })
})

describe('the passkeys of the vault', () => {
  it('are listed, deleted by the popup, and named in the site’s match', async () => {
    const made = await h.core.createPasskey(creation(), origin)
    const list = await h.ok<PasskeyView[]>({ kind: 'passkeys' }, popup)
    expect(list.map((passkey) => passkey.id)).toEqual([made.passkeyId])
    const view = await h.ok<PopupView>({ kind: 'popup', tabId: 7 }, popup)
    expect(view.tab!.match.passkeys).toEqual([made.passkeyId])
    // Not the menu's to list, or to delete
    expect(await h.send({ kind: 'passkeys' }, menuFrame)).toEqual({ ok: false, error: 'refused' })
    expect(await h.send({ kind: 'deletePasskey', id: made.passkeyId }, menuFrame)).toEqual({
      ok: false,
      error: 'refused',
    })
    await h.ok({ kind: 'deletePasskey', id: made.passkeyId }, popup)
    expect(await h.ok({ kind: 'passkeys' }, popup)).toEqual([])
    expect(await h.send({ kind: 'deletePasskey', id: made.passkeyId }, popup)).toEqual({
      ok: false,
      error: 'notFound',
    })
  })

  it('need the vault open', async () => {
    await h.ok({ kind: 'lock' })
    expect(await h.send({ kind: 'passkeys' }, popup)).toEqual({ ok: false, error: 'locked' })
  })
})

describe('what a page may learn of whether Kemlock answers here', () => {
  const status = (url = site) => h.ok<{ active: boolean }>({ kind: 'passkeyStatus' }, content(url))

  it('is the switch, and nothing of the vault or of the sites the person excluded', async () => {
    expect(await status()).toEqual({ active: true })
    await h.ok({ kind: 'passkeyHereSet', host: 'orbit-cloud.com', off: true })
    expect(await status()).toEqual({ active: true })
    await h.ok({ kind: 'lock' })
    expect(await status()).toEqual({ active: true })
    h.done()
    h = await harness({ sample: false })
    expect(await status()).toEqual({ active: true })
    await h.ok({ kind: 'createVault', password: 'hunter two' })
    await h.ok({ kind: 'saveSettings', settings: { passkeys: false } })
    expect(await status()).toEqual({ active: false })
  })

  it('is a no for a frame with no origin', async () => {
    expect(await h.ok({ kind: 'passkeyStatus' }, { ...content(site), origin: 'null' })).toEqual({
      active: false,
    })
  })
})

describe('the scripts that make it work', () => {
  const registered = () => [...h.mock.registered.keys()].sort()

  it('are registered for every frame, at the start, once access to all sites is held', async () => {
    expect(await h.ok({ kind: 'allSitesGranted' })).toBe(false)
    expect(registered()).toEqual([])
    h.mock.granted.add('<all_urls>')
    h.mock.granted.add('webNavigation')
    await h.ok({ kind: 'allSitesGranted' })
    expect(registered()).toEqual([
      'kemlock-content',
      'kemlock-passkey-bridge',
      'kemlock-passkey-main',
    ])
    expect(h.mock.registered.get('kemlock-passkey-main')).toMatchObject({
      js: ['passkey-main.js'],
      world: 'MAIN',
      matches: ['<all_urls>'],
      allFrames: true,
      runAt: 'document_start',
      persistAcrossSessions: true,
      matchOriginAsFallback: true,
    })
    expect(h.mock.registered.get('kemlock-passkey-bridge')).toMatchObject({
      js: ['passkey-bridge.js'],
      world: 'ISOLATED',
      runAt: 'document_start',
    })
  })

  it('want both grants: all sites alone, or the frame list alone, register no passkey script', async () => {
    h.mock.granted.add('<all_urls>')
    await h.ok({ kind: 'allSitesGranted' })
    expect(registered()).toEqual(['kemlock-content'])
    h.mock.granted.clear()
    h.mock.granted.add('webNavigation')
    await h.bg.onPermissionsChanged()
    expect(registered()).toEqual([])
    h.mock.granted.add('<all_urls>')
    await h.bg.onPermissionsChanged()
    expect(registered()).toEqual([
      'kemlock-content',
      'kemlock-passkey-bridge',
      'kemlock-passkey-main',
    ])
    // Taking either back takes the passkey scripts back
    h.mock.granted.delete('webNavigation')
    await h.bg.onPermissionsChanged()
    expect(registered()).toEqual(['kemlock-content'])
  })

  it('go with the switch, and come back with it, and with the access', async () => {
    h.mock.granted.add('<all_urls>')
    h.mock.granted.add('webNavigation')
    await h.ok({ kind: 'allSitesGranted' })
    await h.ok({ kind: 'saveSettings', settings: { passkeys: false } })
    expect(registered()).toEqual(['kemlock-content'])
    await h.ok({ kind: 'saveSettings', settings: { passkeys: true } })
    expect(registered()).toEqual([
      'kemlock-content',
      'kemlock-passkey-bridge',
      'kemlock-passkey-main',
    ])
    h.mock.granted.clear()
    await h.bg.onPermissionsChanged()
    expect(registered()).toEqual([])
  })

  it('are put back on install and start when the access is held', async () => {
    h.mock.granted.add('<all_urls>')
    h.mock.granted.add('webNavigation')
    await h.bg.setup()
    expect(registered()).toContain('kemlock-passkey-main')
  })
})
