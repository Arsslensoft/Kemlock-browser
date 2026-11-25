import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CardView,
  IdentityView,
  MenuView,
  PendingSave,
  CardInput,
  IdentityInput,
} from '../shared/api'
import { content, harness, menuFrame, popup, useClock, type Harness } from './test/harness'

const shop = 'https://shop.example.com/pay'
const plain = 'http://shop.example.com/pay'
const frameUrl = 'https://js.paymentcloud.example/card'

const cardFields = [
  { id: 'n', kind: 'card', part: 'cardNumber', group: '1' },
  { id: 'h', kind: 'card', part: 'cardName', group: '1' },
  { id: 'm', kind: 'card', part: 'cardExpMonth', group: '1', rules: 'select' },
  { id: 'y', kind: 'card', part: 'cardExpYear', group: '1', rules: 'select' },
  { id: 'c', kind: 'card', part: 'cardCsc', group: '1', rules: 'len:4' },
]

let h: Harness
beforeEach(async () => {
  useClock()
  h = await harness({ unlocked: true })
})
afterEach(() => {
  vi.useRealTimers()
  h.done()
})

const visa: CardInput = {
  name: 'Everyday Visa',
  cardholder: 'Sam Rivera',
  number: '4111 1111 1111 1111',
  brand: 'Visa',
  expMonth: 5,
  expYear: 2029,
  code: '123',
}

const me: IdentityInput = {
  name: 'Me',
  givenName: 'Sam',
  familyName: 'Rivera',
  email: 'sam@example.com',
  phone: '+33 6 12 34 56 78',
  birthDate: '1990-04-02',
  address: { lines: ['1 Orbit Way', 'Floor 2'], city: 'Lyon', postalCode: '69001', country: 'FR' },
}

const saveCard = async (input: CardInput = visa) =>
  (await h.ok<CardView>({ kind: 'saveCard', id: null, input })).id
const saveIdentity = async (input: IdentityInput = me) =>
  (await h.ok<IdentityView>({ kind: 'saveIdentity', id: null, input })).id

const report = (url: string, fields: object[], frameId = 0) =>
  h.ok({ kind: 'fields', fields }, content(url, 7, frameId))

/** The top frame says whether it draws the frame in plain view. */
const topSees = (ok: boolean) => {
  h.mock.tabReply = (sent) =>
    (sent.message as { kind: string }).kind === 'frameVisible' ? { ok } : undefined
}

const fills = () =>
  h.mock.sentToTabs
    .filter((sent) => (sent.message as { kind: string }).kind === 'fill')
    .map((sent) => ({
      ...(sent.message as { fieldId: string; value: string; alt?: string[] }),
      frameId: sent.options?.frameId,
    }))
const valueOf = (fieldId: string) => fills().find((sent) => sent.fieldId === fieldId)

describe('filling a card', () => {
  it('puts each of its parts in the field that asks for it, shaped to the field', async () => {
    const id = await saveCard()
    await report(shop, cardFields)
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(valueOf('n')?.value).toBe('4111111111111111')
    expect(valueOf('h')?.value).toBe('Sam Rivera')
    expect(valueOf('c')?.value).toBe('123')
    // A select is offered the other ways its options may be written
    expect(valueOf('m')).toMatchObject({ value: '05' })
    expect(valueOf('m')?.alt).toContain('5')
    expect(valueOf('y')).toMatchObject({ value: '2029' })
    expect(valueOf('y')?.alt).toContain('29')
    expect(fills()).toHaveLength(5)
  })

  it('writes an expiry in one field as the field shows it', async () => {
    const id = await saveCard()
    for (const [rules, expected] of [
      ['year:2;sep:/', '05/29'],
      ['year:4;sep:/', '05/2029'],
      ['year:4;sep:-', '05-2029'],
      ['len:4;year:2;sep:n', '0529'],
      ['len:4', '0529'],
      ['', '05/29'],
    ] as const) {
      h.mock.sentToTabs.length = 0
      await report(shop, [
        { id: 'e', kind: 'card', part: 'cardExp', group: '1', ...(rules ? { rules } : {}) },
      ])
      await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
      expect(valueOf('e')?.value, rules).toBe(expected)
    }
  })

  it('leaves a field the card has nothing for, and says nothing went in when nothing did', async () => {
    const id = await saveCard({ name: 'Holder only', cardholder: 'Sam' })
    await report(shop, cardFields)
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(fills().map((sent) => sent.fieldId)).toEqual(['h'])
    h.mock.sentToTabs.length = 0
    await report(shop, [{ id: 'n', kind: 'card', part: 'cardNumber', group: '1' }])
    expect(await h.send({ kind: 'fill', tabId: 7, cardId: id }, popup)).toEqual({
      ok: false,
      error: 'noMatch',
    })
  })

  it('fills only the block of the field it was asked for', async () => {
    const id = await saveCard()
    await report(shop, [
      { id: 'n1', kind: 'card', part: 'cardNumber', group: '1' },
      { id: 'n2', kind: 'card', part: 'cardNumber', group: '2' },
    ])
    await h.ok({ kind: 'fill', tabId: 7, frameId: 0, fieldId: 'n2', cardId: id }, popup)
    expect(fills().map((sent) => sent.fieldId)).toEqual(['n2'])
  })

  it('fills one block when no field is named: the one the person is in, else the first', async () => {
    const id = await saveCard()
    const blocks = [
      { id: 'n1', kind: 'card', part: 'cardNumber', group: '1' },
      { id: 'n2', kind: 'card', part: 'cardNumber', group: '2' },
    ]
    await report(shop, blocks)
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(fills().map((sent) => sent.fieldId)).toEqual(['n1'])
    h.mock.sentToTabs.length = 0
    await report(shop, [blocks[0], { ...blocks[1], focus: true }])
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(fills().map((sent) => sent.fieldId)).toEqual(['n2'])
  })

  it('is the card’s own fields only: a login field or an identity field is not filled by it', async () => {
    const id = await saveCard()
    await report(shop, [
      { id: 'u', kind: 'username' },
      { id: 'g', kind: 'identity', part: 'givenName', group: '1' },
      ...cardFields,
    ])
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(
      fills()
        .map((sent) => sent.fieldId)
        .sort(),
    ).toEqual(['c', 'h', 'm', 'n', 'y'])
  })
})

describe('the frame gate', () => {
  it('fills by itself only the top frame over https', async () => {
    const id = await saveCard()
    await report(shop, cardFields)
    await report(frameUrl, cardFields, 3)
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(new Set(fills().map((sent) => sent.frameId))).toEqual(new Set([0]))
  })

  it('asks for the person’s confirmation before it fills a frame inside the page', async () => {
    const id = await saveCard()
    await report(frameUrl, cardFields, 3)
    expect(await h.send({ kind: 'fill', tabId: 7, cardId: id }, popup)).toEqual({
      ok: false,
      error: 'confirm',
    })
    expect(
      await h.send({ kind: 'fill', tabId: 7, frameId: 3, fieldId: 'n', cardId: id }, popup),
    ).toEqual({ ok: false, error: 'confirm' })
    expect(fills()).toEqual([])
  })

  it('won’t fill an http page without it, and says why', async () => {
    const id = await saveCard()
    await report(plain, cardFields)
    expect(await h.send({ kind: 'fill', tabId: 7, cardId: id }, popup)).toEqual({
      ok: false,
      error: 'insecure',
    })
    expect(fills()).toEqual([])
  })

  it('takes the confirmation only from the menu opened for that field, and fills the frame it names', async () => {
    const id = await saveCard()
    await report(frameUrl, cardFields, 3)
    const args = { kind: 'fill', tabId: 7, frameId: 3, fieldId: 'n', cardId: id, picked: true }
    // The popup can't confirm, and a menu that wasn't opened for the field can't either
    expect(await h.send(args, popup)).toEqual({ ok: false, error: 'confirm' })
    expect(await h.send(args, menuFrame)).toEqual({ ok: false, error: 'refused' })
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(frameUrl, 7, 3))
    topSees(true)
    await h.ok(args, menuFrame)
    expect(new Set(fills().map((sent) => sent.frameId))).toEqual(new Set([3]))
    expect(fills()).toHaveLength(5)
    // The top frame was asked about the frame's origin, and nothing else was sent with it
    const asked = h.mock.sentToTabs.find(
      (sent) => (sent.message as { kind: string }).kind === 'frameVisible',
    )
    expect(asked).toMatchObject({
      message: { kind: 'frameVisible', origin: 'https://js.paymentcloud.example' },
      options: { frameId: 0 },
    })
  })

  it('refuses a confirmed fill into a frame the top frame will not vouch for', async () => {
    const id = await saveCard()
    await report(frameUrl, cardFields, 3)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(frameUrl, 7, 3))
    const args = { kind: 'fill', tabId: 7, frameId: 3, fieldId: 'n', cardId: id, picked: true }
    // The page faded the frame, or the top frame can't be asked, or says nothing
    topSees(false)
    expect(await h.send(args, menuFrame)).toEqual({ ok: false, error: 'unverified' })
    h.mock.tabReply = (sent) => {
      if ((sent.message as { kind: string }).kind === 'frameVisible')
        throw new Error('no script there')
      return undefined
    }
    expect(await h.send(args, menuFrame)).toEqual({ ok: false, error: 'unverified' })
    h.mock.tabReply = () => undefined
    expect(await h.send(args, menuFrame)).toEqual({ ok: false, error: 'unverified' })
    expect(fills()).toEqual([])
  })

  it('lets the menu fill an http page after the person confirmed it', async () => {
    const id = await saveCard()
    await report(plain, cardFields)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(plain))
    await h.ok(
      { kind: 'fill', tabId: 7, frameId: 0, fieldId: 'n', cardId: id, picked: true },
      menuFrame,
    )
    expect(fills()).toHaveLength(5)
  })

  it('judges the frame by what the browser reports, not what the page says', async () => {
    const id = await saveCard()
    await h.ok(
      { kind: 'fields', fields: cardFields, url: shop, origin: 'https://shop.example.com' },
      content(plain),
    )
    expect(await h.send({ kind: 'fill', tabId: 7, cardId: id }, popup)).toEqual({
      ok: false,
      error: 'insecure',
    })
  })

  it('tells the content script which origin it filled for, so a page that moved on refuses', async () => {
    const id = await saveCard()
    await report(shop, cardFields)
    await h.ok({ kind: 'fill', tabId: 7, cardId: id }, popup)
    expect(
      h.mock.sentToTabs.every(
        (sent) => (sent.message as { origin?: string }).origin === 'https://shop.example.com',
      ),
    ).toBe(true)
  })
})

describe('filling an identity', () => {
  it('puts its names, contact details and address in the fields that ask for them', async () => {
    const id = await saveIdentity()
    await report(shop, [
      { id: 'g', kind: 'identity', part: 'givenName', group: '1' },
      { id: 'f', kind: 'identity', part: 'familyName', group: '1' },
      { id: 'e', kind: 'identity', part: 'email', group: '1' },
      { id: 'p', kind: 'identity', part: 'phone', group: '1' },
      { id: 'a', kind: 'identity', part: 'street', group: '1', rules: 'area' },
      { id: 'l1', kind: 'identity', part: 'line1', group: '1' },
      { id: 'l2', kind: 'identity', part: 'line2', group: '1' },
      { id: 'z', kind: 'identity', part: 'postalCode', group: '1' },
      { id: 'cy', kind: 'identity', part: 'city', group: '1' },
      { id: 'co', kind: 'identity', part: 'country', group: '1', rules: 'select' },
      { id: 'cn', kind: 'identity', part: 'countryName', group: '1' },
      { id: 'b', kind: 'identity', part: 'birthDate', group: '1', rules: 'date' },
      { id: 'bd', kind: 'identity', part: 'birthDay', group: '1', rules: 'select' },
      { id: 'bm', kind: 'identity', part: 'birthMonth', group: '1', rules: 'select' },
      { id: 'by', kind: 'identity', part: 'birthYear', group: '1', rules: 'select' },
    ])
    await h.ok({ kind: 'fill', tabId: 7, identityId: id }, popup)
    const values = Object.fromEntries(fills().map((sent) => [sent.fieldId, sent.value]))
    expect(values).toEqual({
      g: 'Sam',
      f: 'Rivera',
      e: 'sam@example.com',
      p: '+33 6 12 34 56 78',
      a: '1 Orbit Way\nFloor 2',
      l1: '1 Orbit Way',
      l2: 'Floor 2',
      z: '69001',
      cy: 'Lyon',
      // A select takes the name or the code, a field that asks for the code takes the code, one that asks for the name the name
      co: 'France',
      cn: 'France',
      b: '1990-04-02',
      bd: '02',
      bm: '04',
      by: '1990',
    })
    expect(valueOf('co')?.alt).toEqual(expect.arrayContaining(['FR', 'France']))
    expect(valueOf('bm')?.alt).toEqual(expect.arrayContaining(['4', 'April', 'avril']))
  })

  it('writes a street in one single-line field on one line', async () => {
    const id = await saveIdentity()
    await report(shop, [{ id: 'a', kind: 'identity', part: 'street', group: '1' }])
    await h.ok({ kind: 'fill', tabId: 7, identityId: id }, popup)
    expect(valueOf('a')?.value).toBe('1 Orbit Way, Floor 2')
  })

  it('is held to the same gate as a card', async () => {
    const id = await saveIdentity()
    await report(frameUrl, [{ id: 'g', kind: 'identity', part: 'givenName', group: '1' }], 3)
    expect(await h.send({ kind: 'fill', tabId: 7, identityId: id }, popup)).toEqual({
      ok: false,
      error: 'confirm',
    })
  })
})

describe('the menu on a card or identity field', () => {
  const ask = (fieldId = 'n', frameId = 0) =>
    h.send<MenuView>({ kind: 'menu', tabId: 7, frameId, fieldId }, menuFrame)

  it('lists the cards by name, with no number, and the top frame over https fills without asking', async () => {
    await saveCard()
    await saveCard({ name: 'Pinned', number: '5555555555554444', pinned: true })
    await report(shop, cardFields)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(shop))
    const answer = await ask()
    const view = (answer as { value: MenuView }).value
    expect(view.field).toEqual({ kind: 'card' })
    expect(view.cards?.map((card) => card.name)).toEqual(['Pinned', 'Everyday Visa'])
    expect(view.cards?.[1]).toMatchObject({
      lastFour: '1111',
      brand: 'Visa',
      expMonth: 5,
      expYear: 2029,
    })
    expect(view.form).toEqual({
      origin: 'https://shop.example.com',
      top: true,
      secure: true,
      confirm: false,
    })
    expect(view.logins).toEqual([])
    const json = JSON.stringify(view)
    for (const secret of ['4111111111111111', '5555555555554444', '"123"'])
      expect(json).not.toContain(secret)
  })

  it('says a frame inside the page, or an http page, needs the person’s confirmation, and names the page', async () => {
    await saveCard()
    h.mock.tabs.set(7, { id: 7, url: shop, active: true, windowId: 1 })
    await report(frameUrl, cardFields, 3)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(frameUrl, 7, 3))
    const framed = ((await ask('n', 3)) as { value: MenuView }).value
    expect(framed.form).toEqual({
      origin: 'https://js.paymentcloud.example',
      top: false,
      secure: true,
      confirm: true,
      topSite: 'shop.example.com',
    })
    await report(plain, cardFields)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(plain))
    const insecure = ((await ask('n', 0)) as { value: MenuView }).value
    expect(insecure.form).toMatchObject({ top: true, secure: false, confirm: true })
  })

  it('lists the identities by name and email, never a document', async () => {
    await saveIdentity({ ...me, documents: [{ type: 'passport', number: 'X1234567' }] })
    await report(shop, [{ id: 'g', kind: 'identity', part: 'givenName', group: '1' }])
    await h.ok({ kind: 'openMenu', fieldId: 'g' }, content(shop))
    const view = ((await ask('g')) as { value: MenuView }).value
    expect(view.identities).toEqual([
      expect.objectContaining({ name: 'Me', fullName: 'Sam Rivera', email: 'sam@example.com' }),
    ])
    expect(JSON.stringify(view)).not.toContain('X1234567')
    expect(JSON.stringify(view)).not.toContain('Orbit Way')
  })

  it('lists nothing while locked, so the menu asks to unlock', async () => {
    await saveCard()
    await h.ok({ kind: 'lock' })
    await report(shop, cardFields)
    await h.ok({ kind: 'openMenu', fieldId: 'n' }, content(shop))
    const view = ((await ask()) as { value: MenuView }).value
    expect(view.state.unlocked).toBe(false)
    expect(view.cards).toBeUndefined()
    expect(view.form).toBeUndefined()
  })
})

describe('the right-click menu for a card and an identity', () => {
  const click = (id: string, frameId = 0, pageUrl = shop) =>
    h.bg.onMenuClicked({ menuItemId: id, frameId, pageUrl, frameUrl: pageUrl, editable: true }, {
      id: 7,
    } as chrome.tabs.Tab)
  const kinds = () => h.mock.sentToTabs.map((s) => (s.message as { kind: string }).kind)
  const target = { fieldId: 'n', kind: 'card', part: 'cardNumber', group: '1' }

  beforeEach(() => {
    h.mock.tabReply = (sent) =>
      (sent.message as { kind: string }).kind === 'contextTarget' ? target : undefined
  })

  it('fills the one card there is', async () => {
    await saveCard()
    await report(shop, cardFields)
    await click('kemlock-fill-card')
    expect(fills()).toHaveLength(5)
  })

  it('opens the menu to pick when there are several cards, or when the frame needs the person’s word', async () => {
    await saveCard()
    await saveCard({ name: 'Second', number: '5555555555554444' })
    await report(shop, cardFields)
    await click('kemlock-fill-card')
    expect(fills()).toEqual([])
    expect(h.mock.sentToTabs.at(-1)).toMatchObject({ message: { kind: 'openMenu', fieldId: 'n' } })

    h.mock.sentToTabs.length = 0
    await h.ok({ kind: 'deleteCard', id: (await h.ok<CardView[]>({ kind: 'cards' }))[1].id })
    await report(plain, cardFields)
    await click('kemlock-fill-card', 0, plain)
    expect(fills()).toEqual([])
    expect(h.mock.sentToTabs.at(-1)).toMatchObject({ message: { kind: 'openMenu' } })
  })

  it('fills an identity the same way', async () => {
    await saveIdentity()
    h.mock.tabReply = (sent) =>
      (sent.message as { kind: string }).kind === 'contextTarget'
        ? { fieldId: 'g', kind: 'identity', part: 'givenName', group: '1' }
        : undefined
    await report(shop, [
      { id: 'g', kind: 'identity', part: 'givenName', group: '1' },
      { id: 'e', kind: 'identity', part: 'email', group: '1' },
    ])
    await click('kemlock-fill-identity')
    expect(
      fills()
        .map((sent) => sent.fieldId)
        .sort(),
    ).toEqual(['e', 'g'])
  })

  it('does nothing on a frame that has no card fields', async () => {
    await saveCard()
    await report(shop, [{ id: 'u', kind: 'username' }])
    h.mock.tabReply = (sent) =>
      (sent.message as { kind: string }).kind === 'contextTarget'
        ? { fieldId: 'u', kind: 'username' }
        : undefined
    await click('kemlock-fill-card')
    expect(kinds()).toEqual(['contextTarget'])
  })
})

describe('saving a card after a checkout', () => {
  const sentCard = {
    number: '4111 1111 1111 1111',
    holder: 'Sam Rivera',
    expiry: '05/29',
    month: '',
    year: '',
    code: '123',
  }
  const prompt = (tabId = 7) => h.ok<PendingSave | null>({ kind: 'pendingSave', tabId }, popup)
  const answer = (save: boolean, never = false) =>
    h.ok(
      { kind: 'answerSave', tabId: 7, save, card: true, ...(never ? { never: true } : {}) },
      popup,
    )

  it('offers a card the vault does not hold, by its last four digits and never its number', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    const offer = await prompt()
    expect(offer).toEqual({
      site: 'shop.example.com',
      username: '',
      card: { brand: 'Visa', lastFour: '1111', holder: 'Sam Rivera', expiry: '05/2029' },
    })
    expect(JSON.stringify(offer)).not.toContain('4111111111111111')
  })

  it('shows the prompt once the page has loaded, in the top frame', async () => {
    h.mock.tabs.set(7, { id: 7, url: shop, active: true, windowId: 1 })
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await vi.advanceTimersByTimeAsync(3000)
    // The timer starts a chain of reads (the offers, the tab's state); a slow runner may still be in it
    await vi.waitFor(() => {
      expect(
        h.mock.sentToTabs.some((s) => (s.message as { kind: string }).kind === 'savePrompt'),
      ).toBe(true)
    })
    expect(h.mock.sentToTabs.at(-1)?.options).toMatchObject({ frameId: 0 })
  })

  it('saves it, as a card from the page, when the person says yes', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await answer(true)
    const [saved] = await h.ok<CardView[]>({ kind: 'cards' })
    expect(saved).toMatchObject({
      name: 'Visa •••• 1111',
      brand: 'Visa',
      lastFour: '1111',
      expMonth: 5,
      expYear: 2029,
    })
    expect(h.core.calls).toContain('saveCard')
    // Asked once: the offer is gone
    expect(await prompt()).toBeNull()
  })

  it('reads the month and the year from fields of their own', async () => {
    await h.ok(
      { kind: 'cardSent', ...sentCard, expiry: '', month: '09', year: '2031' },
      content(shop),
    )
    await answer(true)
    expect(await h.ok<CardView[]>({ kind: 'cards' })).toMatchObject([
      { expMonth: 9, expYear: 2031 },
    ])
  })

  it('asks nothing for a card the vault holds, or when the person said not to', async () => {
    await saveCard()
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok(
      { kind: 'saveCard', id: null, input: { name: 'x', number: '5555555555554444' } },
      popup,
    )
    await h.ok({ kind: 'cardSent', ...sentCard, number: '378282246310005' }, content(shop))
    expect(await prompt()).not.toBeNull()
    await answer(false, true)
    await h.ok({ kind: 'cardSent', ...sentCard, number: '378282246310005' }, content(shop))
    expect(await prompt()).toBeNull()
  })

  it('does not take what is not a card number, or a page that says no prompts', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard, number: '4111111111111112' }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok({ kind: 'saveSettings', settings: { offerToSave: false } }, popup)
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    expect(await prompt()).toBeNull()
  })

  it('forgets the card, with its code, when the vault locks', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await h.ok({ kind: 'lock' })
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('4111111111111111')
  })

  it('may be sent only by a content script', async () => {
    expect(await h.send({ kind: 'cardSent', ...sentCard }, popup)).toEqual({
      ok: false,
      error: 'refused',
    })
  })
})

describe('the offers a tab holds', () => {
  const sentCard = {
    number: '4111111111111111',
    holder: 'Sam Rivera',
    expiry: '05/29',
    month: '',
    year: '',
    code: '123',
  }
  const sentIdentity = {
    given: 'Sam',
    family: 'Rivera',
    full: '',
    email: 'sam@example.com',
    phone: '',
    company: '',
    line1: '1 Orbit Way',
    city: 'Lyon',
    postalCode: '69001',
    country: 'France',
  }
  const prompt = () => h.ok<PendingSave | null>({ kind: 'pendingSave', tabId: 7 }, popup)
  const answer = (flags: object) =>
    h.ok({ kind: 'answerSave', tabId: 7, save: true, ...flags }, popup)

  it('keeps no card while the vault is locked, nor a full number in storage after it locks', async () => {
    await h.ok({ kind: 'lock' })
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await h.ok({ kind: 'identitySent', ...sentIdentity }, content(shop))
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('4111111111111111')
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('sam@example.com')
    await h.ok({ kind: 'unlock', password: 'correct horse' })
    expect(await prompt()).toBeNull()
  })

  it('drops a card that waited too long, wherever it is looked at, and on the alarm', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await h.ok({ kind: 'identitySent', ...sentIdentity }, content(shop))
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    await h.bg.onAlarm({ name: 'something' })
    expect(JSON.stringify([...h.mock.session.entries()])).toContain('4111111111111111')
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await h.bg.onAlarm({ name: 'something' })
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('4111111111111111')
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('sam@example.com')
    expect(await prompt()).toBeNull()
  })

  it('drops a stale card when the prompt looks at it, with no alarm', async () => {
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(await prompt()).toBeNull()
    expect(JSON.stringify([...h.mock.session.entries()])).not.toContain('4111111111111111')
  })

  it('shows the newest of a login, a card and an identity', async () => {
    await h.ok({ kind: 'sent', username: 'alex', password: 'Harbor-pass-1!' }, content(shop))
    await vi.advanceTimersByTimeAsync(1000)
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    expect(await prompt()).toMatchObject({ card: { lastFour: '1111' } })
    await vi.advanceTimersByTimeAsync(1000)
    await h.ok({ kind: 'identitySent', ...sentIdentity }, content(shop))
    expect(await prompt()).toMatchObject({
      identity: { name: 'Sam Rivera', email: 'sam@example.com' },
    })
  })

  it('acts only on the offer an answer names', async () => {
    await h.ok({ kind: 'sent', username: 'alex', password: 'Harbor-pass-1!' }, content(shop))
    await h.ok({ kind: 'cardSent', ...sentCard }, content(shop))
    await h.ok({ kind: 'identitySent', ...sentIdentity }, content(shop))
    await answer({ card: true })
    expect(await h.ok<CardView[]>({ kind: 'cards' })).toHaveLength(1)
    expect(await h.ok<IdentityView[]>({ kind: 'identities' })).toHaveLength(0)
    expect(await h.ok<unknown[]>({ kind: 'logins' })).toHaveLength(1)
    await answer({ identity: true })
    expect(await h.ok<IdentityView[]>({ kind: 'identities' })).toHaveLength(1)
    expect(await h.ok<unknown[]>({ kind: 'logins' })).toHaveLength(1)
    // What is left is the login's
    expect(await prompt()).toMatchObject({ username: 'alex' })
    await answer({})
    expect(await h.ok<unknown[]>({ kind: 'logins' })).toHaveLength(2)
  })
})

describe('saving an identity after an address form', () => {
  const sent = {
    given: 'Sam',
    family: 'Rivera',
    full: '',
    email: 'sam@example.com',
    phone: '+33 6 12 34 56 78',
    company: '',
    line1: '1 Orbit Way',
    city: 'Lyon',
    postalCode: '69001',
    country: 'France',
  }
  const prompt = () => h.ok<PendingSave | null>({ kind: 'pendingSave', tabId: 7 }, popup)
  const answer = (save: boolean, never = false) =>
    h.ok(
      { kind: 'answerSave', tabId: 7, save, identity: true, ...(never ? { never: true } : {}) },
      popup,
    )

  it('offers a person the vault does not hold, by name, email and address', async () => {
    await h.ok({ kind: 'identitySent', ...sent }, content(shop))
    expect(await prompt()).toEqual({
      site: 'shop.example.com',
      username: '',
      identity: {
        name: 'Sam Rivera',
        email: 'sam@example.com',
        address: '1 Orbit Way, 69001 Lyon',
      },
    })
  })

  it('saves them, the country as its code, on yes', async () => {
    await h.ok({ kind: 'identitySent', ...sent }, content(shop))
    await answer(true)
    const [saved] = await h.ok<IdentityView[]>({ kind: 'identities' })
    expect(saved).toMatchObject({
      name: 'Sam Rivera',
      givenName: 'Sam',
      familyName: 'Rivera',
      email: 'sam@example.com',
      phone: '+33 6 12 34 56 78',
      address: { lines: ['1 Orbit Way'], city: 'Lyon', postalCode: '69001', country: 'FR' },
    })
    expect(await prompt()).toBeNull()
  })

  it('splits one name field at its last word', async () => {
    await h.ok(
      { kind: 'identitySent', ...sent, given: '', family: '', full: 'Mary Ann Smith' },
      content(shop),
    )
    await answer(true)
    expect(await h.ok<IdentityView[]>({ kind: 'identities' })).toMatchObject([
      { givenName: 'Mary Ann', familyName: 'Smith' },
    ])
  })

  it('asks nothing for a person the vault holds, by email or by name and postal code', async () => {
    await h.ok({
      kind: 'saveIdentity',
      id: null,
      input: { name: 'Me', email: 'SAM@example.com' },
    })
    await h.ok({ kind: 'identitySent', ...sent }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok({
      kind: 'saveIdentity',
      id: null,
      input: {
        name: 'Mary Smith',
        givenName: 'Mary',
        familyName: 'Smith',
        address: { postalCode: '75001' },
      },
    })
    await h.ok(
      {
        kind: 'identitySent',
        ...sent,
        email: '',
        given: 'Mary',
        family: 'Smith',
        postalCode: '75001',
      },
      content(shop),
    )
    expect(await prompt()).toBeNull()
  })

  it('is not taken from a form with no name, or no email and no street, or when the offer is off or never', async () => {
    await h.ok({ kind: 'identitySent', ...sent, given: '', family: '' }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok({ kind: 'identitySent', ...sent, email: 'nope', line1: '' }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok({ kind: 'identitySent', ...sent }, content(shop))
    expect(await prompt()).not.toBeNull()
    await answer(false, true)
    await h.ok({ kind: 'identitySent', ...sent }, content(shop))
    expect(await prompt()).toBeNull()
    await h.ok({ kind: 'saveSettings', settings: { offerToSave: false } }, popup)
    await h.ok({ kind: 'identitySent', ...sent, host: 'x' }, content(plain))
    expect(await prompt()).toBeNull()
  })

  it('may be sent only by a content script', async () => {
    expect(await h.send({ kind: 'identitySent', ...sent }, popup)).toEqual({
      ok: false,
      error: 'refused',
    })
  })
})
