// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Controller, type Call } from './controller'
import type { Geometry } from './dom'

let rectTop = 10

const geometry: Geometry = {
  rect: () => ({ left: 10, top: rectTop, width: 200, height: 30 }),
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

const nativeValue = (input: HTMLInputElement) =>
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(input) as string

const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

const signIn = `
  <form id="login">
    <input name="email" autocomplete="username">
    <input type="password" name="pw" autocomplete="current-password">
    <button type="button" id="go">Sign in</button>
  </form>`

let buttons = true
let calls: { kind: string; args: unknown }[]
let controller: Controller

function make(isTop = true) {
  const call = vi.fn(async (kind: string, args: unknown) => {
    calls.push({ kind, args })
    if (kind === 'fields') return { buttons }
    if (kind === 'frame') return { tabId: 4, frameId: 0 }
    return undefined
  }) as unknown as Call
  controller = new Controller({
    doc: document,
    call,
    pageUrl: 'chrome-extension://abc/src/menu/index.html',
    label: 'Fill with Kemlock',
    origin: 'https://orbit.test',
    isTop,
    geometry,
  })
  return controller
}

const sent = () => calls.filter((c) => c.kind === 'sent').map((c) => c.args)

beforeEach(() => {
  rectTop = 10
  buttons = true
  calls = []
  document.body.innerHTML = ''
})

afterEach(() => {
  controller?.stop()
})

describe('finding fields', () => {
  it("reports the frame's fields to the background and places a button in each", async () => {
    document.body.innerHTML = signIn
    const page = document.body.children.length
    await make().scan()
    expect(calls[0]).toEqual({
      kind: 'fields',
      args: {
        fields: [
          { id: 'f1', kind: 'username' },
          { id: 'f2', kind: 'password' },
        ],
      },
    })
    const added = Array.from(document.body.children).slice(page) as HTMLElement[]
    expect(added).toHaveLength(2)
    expect(added[0].style.getPropertyValue('--kemlock-show')).toBe('block')
    expect(added[0].style.getPropertyValue('--kemlock-width')).not.toBe('')
  })

  it('places no button when the background says buttons are off', async () => {
    buttons = false
    document.body.innerHTML = signIn
    const page = document.body.children.length
    await make().scan()
    expect(document.body.children.length).toBe(page)
  })

  it('says nothing of a page with no fields, and nothing again when nothing changed', async () => {
    document.body.innerHTML = '<p>Hello</p>'
    const c = make()
    await c.scan()
    expect(calls).toEqual([])
    document.body.innerHTML = signIn
    await c.scan()
    await c.scan()
    expect(calls.filter((call) => call.kind === 'fields')).toHaveLength(1)
  })

  it('takes a button away when its field goes', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    document.getElementById('login')!.remove()
    await c.scan()
    expect(document.body.children.length).toBe(0)
  })

  it('hides a button whose field is scrolled out of view, and brings it back', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const hosts = Array.from(document.body.children).slice(1) as HTMLElement[]
    expect(hosts[0].style.getPropertyValue('--kemlock-show')).toBe('block')
    rectTop = -500
    c.place()
    expect(hosts[0].style.getPropertyValue('--kemlock-show')).toBe('none')
    rectTop = 10
    c.place()
    expect(hosts[0].style.getPropertyValue('--kemlock-show')).toBe('block')
  })
})

describe('filling', () => {
  it('fills the field it was asked for, and says so', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    expect(c.handle({ kind: 'fill', fieldId: 'f1', value: 'alice@example.com' })).toEqual({
      ok: true,
    })
    expect(nativeValue($('[name=email]'))).toBe('alice@example.com')
    expect(nativeValue($('[name=pw]'))).toBe('')
  })

  it('fills only for the origin the background matched the item against', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const other = { kind: 'fill', fieldId: 'f1', value: 'x', origin: 'https://evil.test' }
    expect(c.handle(other)).toEqual({ ok: false })
    expect(nativeValue($('[name=email]'))).toBe('')
    expect(c.handle({ ...other, origin: 'https://orbit.test' })).toEqual({ ok: true })
  })

  it('reports a new password with the rules of its form', async () => {
    document.body.innerHTML =
      '<input type="password" autocomplete="new-password" maxlength="16"><input type="password" autocomplete="new-password">'
    await make().scan()
    expect(calls[0].args).toEqual({
      fields: [
        { id: 'f1', kind: 'newPassword', rules: 'maxlength: 16' },
        { id: 'f2', kind: 'newPassword', rules: 'maxlength: 16' },
      ],
    })
  })

  it('refuses a field it never registered', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    expect(c.handle({ kind: 'fill', fieldId: 'f9', value: 'x' })).toEqual({ ok: false })
    expect(c.handle({ kind: 'fill', fieldId: 'f1' })).toEqual({ ok: false })
  })

  it('refuses a field the page replaced after it was registered', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const old = $('[name=email]')
    old.replaceWith(old.cloneNode())
    expect(c.handle({ kind: 'fill', fieldId: 'f1', value: 'x' })).toEqual({ ok: false })
    expect(nativeValue($('[name=email]'))).toBe('')
  })

  it('never fills a field the page hid after it was registered', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=pw]').style.opacity = '0'
    expect(c.handle({ kind: 'fill', fieldId: 'f2', value: 'x' })).toEqual({ ok: false })
  })

  it('fills six boxes one digit each', async () => {
    document.body.innerHTML = Array.from({ length: 6 }, () => '<input maxlength="1">').join('')
    const c = make()
    await c.scan()
    expect(calls[0].args).toEqual({ fields: [{ id: 'f1', kind: 'code', boxes: 6 }] })
    expect(c.handle({ kind: 'fill', fieldId: 'f1', value: '482913' })).toEqual({ ok: true })
    expect(Array.from(document.querySelectorAll('input')).map(nativeValue)).toEqual([
      '4',
      '8',
      '2',
      '9',
      '1',
      '3',
    ])
  })

  it('ignores messages that are not its own', () => {
    expect(make().handle({ kind: 'other' })).toBeUndefined()
    expect(make().handle('fill')).toBeUndefined()
  })
})

describe('the right-click menu', () => {
  function rightClick(c: Controller, input: HTMLInputElement) {
    input.addEventListener('contextmenu', (event) => c.contextMenu(event as MouseEvent), {
      once: true,
    })
    input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true }))
  }

  it('answers which field a field no rule found was, and makes it fillable', () => {
    document.body.innerHTML = '<input name="weird">'
    const c = make()
    const input = $('[name=weird]')
    rightClick(c, input)
    expect(c.handle({ kind: 'contextTarget' })).toEqual({ fieldId: 'f1', kind: 'username' })
    expect(c.handle({ kind: 'fill', fieldId: 'f1', value: '123456' })).toEqual({ ok: true })
    expect(nativeValue(input)).toBe('123456')
  })

  it('answers a password field as a password', () => {
    document.body.innerHTML = '<input type="password" name="odd">'
    const c = make()
    rightClick(c, $('[name=odd]'))
    expect(c.handle({ kind: 'contextTarget' })).toEqual({ fieldId: 'f1', kind: 'password' })
  })

  it('answers a registered field as itself, a box as its whole code', async () => {
    document.body.innerHTML = Array.from({ length: 6 }, () => '<input maxlength="1">').join('')
    const c = make()
    await c.scan()
    rightClick(c, document.querySelectorAll('input')[3])
    expect(c.handle({ kind: 'contextTarget' })).toEqual({ fieldId: 'f1', kind: 'code', boxes: 6 })
  })

  it('answers a new password with the rules of its form', async () => {
    document.body.innerHTML =
      '<input type="password" autocomplete="new-password" maxlength="16"><input type="password" autocomplete="new-password">'
    const c = make()
    await c.scan()
    rightClick(c, document.querySelectorAll('input')[0])
    expect(c.handle({ kind: 'contextTarget' })).toEqual({
      fieldId: 'f1',
      kind: 'newPassword',
      rules: 'maxlength: 16',
    })
  })

  it('answers null when no field was right-clicked', () => {
    document.body.innerHTML = '<p>text</p>'
    expect(make().handle({ kind: 'contextTarget' })).toBeNull()
  })
})

describe('the menu frame', () => {
  it('opens on a field when the background asks, then closes', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const reply = await c.handle({ kind: 'openMenu', fieldId: 'f2' })
    expect(reply).toEqual({ ok: true })
    expect(calls.map((call) => call.kind)).toContain('openMenu')
    expect(calls.find((call) => call.kind === 'openMenu')?.args).toEqual({ fieldId: 'f2' })
    expect(c.menuOpen).toBe(true)
    c.closeMenu(false)
    expect(c.menuOpen).toBe(false)
  })

  it('opens on no field it does not know', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    expect(await c.handle({ kind: 'openMenu', fieldId: 'f9' })).toEqual({ ok: false })
    expect(c.menuOpen).toBe(false)
  })

  it('opens from the down arrow', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const input = $('[name=email]')
    const arrow = () =>
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        composed: true,
        cancelable: true,
      })
    const on = arrow()
    input.addEventListener('keydown', (event) => c.arrowDown(event as KeyboardEvent), {
      once: true,
    })
    input.dispatchEvent(on)
    expect(on.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(c.menuOpen).toBe(true))
    c.closeMenu(false)
  })

  it('leaves the down arrow alone when buttons are off', async () => {
    buttons = false
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const input = $('[name=email]')
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    input.addEventListener('keydown', (e) => c.arrowDown(e as KeyboardEvent), { once: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(c.menuOpen).toBe(false)
  })

  it('shows the save prompt in the top frame only', async () => {
    expect(await make(false).handle({ kind: 'savePrompt' })).toEqual({ ok: false })
    const top = make(true)
    expect(await top.handle({ kind: 'savePrompt' })).toEqual({ ok: true })
    expect(top.handle({ kind: 'closeMenus' })).toEqual({ ok: true })
  })
})

describe('forms being sent', () => {
  it('sends the username and password when a form is submitted', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=email]').value = 'alice@example.com'
    $('[name=pw]').value = 'hunter2'
    const form = document.getElementById('login')!
    form.addEventListener('submit', (event) => c.submitted(event))
    form.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(sent()).toEqual([{ username: 'alice@example.com', password: 'hunter2' }])
  })

  it('sends a sign-up as a new password', async () => {
    document.body.innerHTML = `
      <form id="up"><input name="email" type="email" autocomplete="username">
      <input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>`
    const c = make()
    await c.scan()
    const [email, one, two] = Array.from(document.querySelectorAll('input'))
    email.value = 'new@example.com'
    one.value = 'a-good-one'
    two.value = 'a-good-one'
    const form = document.getElementById('up')!
    form.addEventListener('submit', (event) => c.submitted(event))
    form.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(sent()).toEqual([
      { username: 'new@example.com', password: '', newPassword: 'a-good-one' },
    ])
  })

  it('sends one submit once, though the button press came first', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=email]').value = 'alice@example.com'
    $('[name=pw]').value = 'hunter2'
    const form = document.getElementById('login')!
    form.addEventListener('submit', (event) => c.submitted(event))
    form.dispatchEvent(new Event('submit', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(sent()).toHaveLength(1)
  })

  it('sends nothing for an empty form', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    const form = document.getElementById('login')!
    form.addEventListener('submit', (event) => c.submitted(event))
    form.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(sent()).toEqual([])
  })

  it('sends a button press when the form then goes away', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=email]').value = 'alice@example.com'
    $('[name=pw]').value = 'hunter2'
    const button = document.getElementById('go')!
    button.addEventListener('click', (event) => c.pressedPage(event))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    expect(sent()).toEqual([])
    document.getElementById('login')!.remove()
    await c.scan()
    expect(sent()).toEqual([{ username: 'alice@example.com', password: 'hunter2' }])
  })

  it('sends a button press when the page navigates', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=pw]').value = 'hunter2'
    const button = document.getElementById('go')!
    button.addEventListener('click', (event) => c.pressedPage(event))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    c.navigated()
    expect(sent()).toEqual([{ username: '', password: 'hunter2' }])
  })

  it('sends nothing for a button press the page did nothing with', async () => {
    document.body.innerHTML = signIn
    const c = make()
    await c.scan()
    $('[name=pw]').value = 'hunter2'
    const button = document.getElementById('go')!
    button.addEventListener('click', (event) => c.pressedPage(event))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await c.scan()
    expect(sent()).toEqual([])
  })
})
