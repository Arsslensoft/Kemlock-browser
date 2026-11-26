// @vitest-environment jsdom
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { FormGate, MenuCard, MenuIdentity, MenuView, PendingSave } from '../shared/api'
import { App } from './App'
import type { Channel, Init } from './channel'
import { cardDetail, identityDetail } from './forms'
import type { Verdict } from './gate'
import contentEn from '../../locales/parts/content.en.json'
import itemsEn from '../../locales/parts/items.en.json'

const en: Record<string, string> = { ...contentEn, ...itemsEn }

/** The browser's getMessage: placeholders filled in the order they first appear. */
function message(name: string, substitutions: string[] = []): string {
  const text = en[name]
  if (text === undefined) return ''
  const order: string[] = []
  return text.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!order.includes(key)) order.push(key)
    return substitutions[order.indexOf(key)] ?? ''
  })
}

const visa: MenuCard = {
  id: 'k1',
  name: 'Everyday Visa',
  brand: 'Visa',
  lastFour: '1111',
  expMonth: 5,
  expYear: 2029,
  expired: false,
  cardholder: 'Sam Rivera',
  pinned: false,
}
const amex: MenuCard = {
  ...visa,
  id: 'k2',
  name: 'Old Amex',
  brand: 'Amex',
  lastFour: '0005',
  expired: true,
}
const me: MenuIdentity = {
  id: 'i1',
  name: 'Me',
  fullName: 'Sam Rivera',
  email: 'sam@example.com',
  pinned: false,
}

const gate = (over: Partial<FormGate> = {}): FormGate => ({
  origin: 'https://shop.example.com',
  top: true,
  secure: true,
  confirm: false,
  ...over,
})

const view = (over: Partial<MenuView> = {}): MenuView => ({
  state: { exists: true, unlocked: true, wrongPasswords: 0, fileSync: 'readOnly' },
  match: { site: 'shop.example.com', logins: [], codes: [] },
  logins: [],
  codes: [],
  field: { kind: 'card' },
  cards: [visa, amex],
  form: gate(),
  ...over,
})

const init = (over: Partial<Init> = {}): Init => ({
  mode: 'menu',
  tabId: 4,
  frameId: 0,
  fieldId: 'n',
  ...over,
})

type Handler = (args: Record<string, unknown>) => unknown
let handlers: Record<string, Handler>
let sendMessage: ReturnType<typeof vi.fn>
let channel: {
  permit: Mock<Channel['permit']>
  size: Mock<Channel['size']>
  close: Mock<Channel['close']>
}

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))

async function mount(options: Init = init()) {
  await act(() => {
    render(<App channel={channel} init={options} />, document.body)
  })
  await settle()
}

const sent = (kind: string) =>
  sendMessage.mock.calls.map(([m]) => m as { kind: string }).filter((m) => m.kind === kind)
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row]'))
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label))!
const shown = () => document.body.textContent ?? ''
const click = async (element: Element) => {
  await act(() => {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1, clientX: 5, clientY: 5 }),
    )
  })
  await settle()
}

beforeEach(() => {
  handlers = {}
  sendMessage = vi.fn(async (request: { kind: string }) => {
    const handler = handlers[request.kind]
    if (handler === undefined) return { ok: false, error: 'unsupported' }
    try {
      return { ok: true, value: handler(request) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  channel = {
    permit: vi.fn<Channel['permit']>(async (): Promise<Verdict> => ({ ok: true })),
    size: vi.fn<Channel['size']>(),
    close: vi.fn<Channel['close']>(),
  }
  vi.stubGlobal('chrome', { i18n: { getMessage: message }, runtime: { sendMessage } })
  document.body.innerHTML = ''
})

afterEach(() => {
  render(null, document.body)
  vi.unstubAllGlobals()
})

describe('the list on a card field', () => {
  it('shows each card by name, brand, last four digits and expiry', async () => {
    handlers.menu = () => view()
    await mount()
    expect(rows().map((row) => row.textContent)).toEqual([
      'EEveryday VisaVisa •••• 1111 · 05/2029',
      `OOld AmexAmex •••• 0005 · 05/2029 · ${message('items_menu_expired')}`,
    ])
    expect(shown()).not.toContain('4111')
    expect(shown()).toContain(message('items_menu_cardTitle'))
  })

  it('fills the card on a click in the top frame over https, with no question', async () => {
    handlers.menu = () => view()
    handlers.fill = () => undefined
    await mount()
    await click(rows()[0]!)
    expect(channel.permit).toHaveBeenCalled()
    expect(sent('fill')).toEqual([
      { kind: 'fill', tabId: 4, frameId: 0, fieldId: 'n', cardId: 'k1' },
    ])
    expect(channel.close).toHaveBeenCalledWith(true)
  })

  it('fills nothing when the gate says the click does not count, and says why', async () => {
    handlers.menu = () => view()
    channel.permit.mockResolvedValue({ ok: false, why: 'covered' })
    await mount()
    await click(rows()[0]!)
    expect(sent('fill')).toEqual([])
    expect(shown()).toContain(message('menu_gate_covered'))
  })

  it('says there is no card to fill', async () => {
    handlers.menu = () => view({ cards: [] })
    await mount()
    expect(shown()).toContain(message('items_menu_noCards'))
  })

  it('offers a search when there are many, and narrows the list by it', async () => {
    handlers.menu = () =>
      view({
        cards: Array.from({ length: 7 }, (_, i) => ({ ...visa, id: `k${i}`, name: `Card ${i}` })),
      })
    await mount()
    const search = document.querySelector<HTMLInputElement>('input[type=search]')
    expect(search).not.toBeNull()
    await act(() => {
      search!.value = 'card 3'
      search!.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining('Card 3')])
  })
})

describe('the confirmation before a frame or an http page', () => {
  const framed = () =>
    view({
      form: gate({
        origin: 'https://js.paymentcloud.example',
        top: false,
        confirm: true,
        topSite: 'shop.example.com',
      }),
    })

  it('asks first, with the frame’s own address and the page it is in, and fills only after Fill', async () => {
    handlers.menu = framed
    handlers.fill = () => undefined
    await mount()
    expect(shown()).toContain(message('items_menu_asksFirst'))
    await click(rows()[0]!)
    expect(sent('fill')).toEqual([])
    expect(shown()).toContain(message('items_menu_confirmTitle', ['Everyday Visa']))
    expect(shown()).toContain('https://js.paymentcloud.example')
    expect(shown()).toContain(message('items_menu_inFrame', ['shop.example.com']))
    await click(button(message('menu_fill')))
    expect(sent('fill')).toEqual([
      { kind: 'fill', tabId: 4, frameId: 0, fieldId: 'n', cardId: 'k1', picked: true },
    ])
  })

  it('starts the click gate’s delay again when it shows, and puts the focus on Back', async () => {
    handlers.menu = framed
    const restart = vi.fn()
    channel = { ...channel, restart } as typeof channel & { restart: () => void }
    await mount()
    await click(rows()[0]!)
    expect(restart).toHaveBeenCalled()
    expect(document.activeElement).toBe(button(message('menu_back')))
  })

  it('shows what the top frame would not vouch for, and fills nothing', async () => {
    handlers.menu = framed
    handlers.fill = () => {
      throw new Error('unverified')
    }
    await mount()
    await click(rows()[0]!)
    await click(button(message('menu_fill')))
    expect(shown()).toContain(message('items_menu_unverified'))
  })

  it('goes back to the list without filling', async () => {
    handlers.menu = framed
    await mount()
    await click(rows()[0]!)
    await click(button(message('menu_back')))
    expect(rows()).toHaveLength(2)
    expect(sent('fill')).toEqual([])
  })

  it('warns about an http page', async () => {
    handlers.menu = () => view({ form: gate({ secure: false, confirm: true }) })
    await mount()
    await click(rows()[0]!)
    expect(shown()).toContain(message('items_menu_insecure'))
  })

  it('says so when the background refuses all the same', async () => {
    handlers.menu = () => view()
    handlers.fill = () => {
      throw new Error('confirm')
    }
    await mount()
    await click(rows()[0]!)
    expect(shown()).toContain(message('items_menu_needsConfirm'))
  })
})

describe('the list on an identity field', () => {
  it('shows each identity by name, its person and its email', async () => {
    handlers.menu = () => view({ field: { kind: 'identity' }, cards: undefined, identities: [me] })
    handlers.fill = () => undefined
    await mount(init({ fieldId: 'g' }))
    expect(shown()).toContain(message('items_menu_identityTitle'))
    expect(rows().map((row) => row.textContent)).toEqual(['MMeSam Rivera · sam@example.com'])
    await click(rows()[0]!)
    expect(sent('fill')).toEqual([
      { kind: 'fill', tabId: 4, frameId: 0, fieldId: 'g', identityId: 'i1' },
    ])
  })
})

describe('the save prompt for a card', () => {
  const offer: PendingSave = {
    site: 'shop.example.com',
    username: '',
    card: { brand: 'Visa', lastFour: '1111', holder: 'Sam Rivera', expiry: '05/2029' },
  }

  it('shows the card by its last digits, never its number, and saves on Save', async () => {
    handlers.pendingSave = () => offer
    handlers.answerSave = () => undefined
    await mount(init({ mode: 'save', fieldId: '' }))
    expect(shown()).toContain(message('items_menu_saveCard'))
    expect(shown()).toContain('Visa •••• 1111')
    expect(shown()).toContain('Sam Rivera')
    expect(shown()).toContain('05/2029')
    expect(shown()).toContain('shop.example.com')
    expect(shown()).not.toContain(message('menu_save_user'))
    await click(button(message('menu_save')))
    // The answer says which offer it is for
    expect(sent('answerSave')).toEqual([{ kind: 'answerSave', tabId: 4, save: true, card: true }])
  })

  it('shows an identity by its name, email and address, and answers for it', async () => {
    handlers.pendingSave = () => ({
      site: 'shop.example.com',
      username: '',
      identity: {
        name: 'Sam Rivera',
        email: 'sam@example.com',
        address: '1 Orbit Way, 69001 Lyon',
      },
    })
    handlers.answerSave = () => undefined
    await mount(init({ mode: 'save', fieldId: '' }))
    expect(shown()).toContain(message('items_menu_saveIdentity'))
    expect(shown()).toContain('Sam Rivera')
    expect(shown()).toContain('sam@example.com')
    expect(shown()).toContain('1 Orbit Way, 69001 Lyon')
    await click(button(message('menu_save')))
    expect(sent('answerSave')).toEqual([
      { kind: 'answerSave', tabId: 4, save: true, identity: true },
    ])
  })

  it('answers a login with neither flag', async () => {
    handlers.pendingSave = () => ({ site: 'shop.example.com', username: 'alex' })
    handlers.answerSave = () => undefined
    await mount(init({ mode: 'save', fieldId: '' }))
    await click(button(message('menu_save')))
    expect(sent('answerSave')).toEqual([{ kind: 'answerSave', tabId: 4, save: true }])
  })
})

describe('what tells an item apart', () => {
  it('writes a card’s brand, last digits and expiry, and an identity’s person and email', () => {
    expect(cardDetail(visa)).toBe('Visa •••• 1111 · 05/2029')
    expect(cardDetail({ ...visa, brand: undefined, expMonth: undefined, expYear: undefined })).toBe(
      '•••• 1111',
    )
    expect(identityDetail(me)).toBe('Sam Rivera · sam@example.com')
    expect(identityDetail({ ...me, fullName: 'Me', email: undefined, company: 'Orbit' })).toBe(
      'Orbit',
    )
  })
})
