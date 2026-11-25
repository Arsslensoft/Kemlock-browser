// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Controller, type Call } from './controller'
import { fieldNames, type Geometry } from './dom'
import { IdentityCapture, readIdentity, type IdentitySent } from './form-capture'
import { readFormFields } from './formdom'
import { scanFrame } from './scan'
import { withForms } from './scan-forms'

const normal = { left: 10, top: 10, width: 200, height: 30 }
const geometry: Geometry = {
  rect: () => normal,
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

const page = (html: string) => {
  document.body.innerHTML = html
}
const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

function scanAll() {
  const names = fieldNames()
  const found = scanFrame(document, names, geometry)
  return { ...withForms(found, document, names, geometry), names }
}
const kinds = (scan: ReturnType<typeof scanAll>) =>
  scan.reports.map((report) => `${report.kind}:${report.part ?? ''}`)

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('blocks of fields with no form', () => {
  it('are told apart by the fieldset or section they sit in', () => {
    page(`
      <fieldset><input name="fname"><input name="lname"></fieldset>
      <section><div><input name="fname"><input name="lname"></div></section>
      <input name="loose">`)
    const groups = readFormFields(document, fieldNames(), geometry).map((field) => field.group)
    expect(groups[0]).toBe(groups[1])
    expect(groups[2]).toBe(groups[3])
    expect(groups[0]).not.toBe(groups[2])
    // A field with neither is block 0
    expect(groups[4]).toBe('0')
  })

  it('are told apart from a form’s fields too', () => {
    page(`
      <form><input name="fname"></form>
      <fieldset><input name="fname"></fieldset>`)
    const groups = readFormFields(document, fieldNames(), geometry).map((field) => field.group)
    expect(groups[0]).not.toBe(groups[1])
  })

  it('carry which field the person is in, so a fill with none named fills that block', () => {
    page(`
      <fieldset><input name="fname"><input name="lname"></fieldset>
      <fieldset><input name="fname" id="second"><input name="lname"></fieldset>`)
    $('#second').focus()
    const scan = scanAll()
    const focused = scan.reports.filter((report) => report.focus === true)
    expect(focused.map((report) => report.part)).toEqual(['givenName'])
    expect(focused[0]?.group).not.toBe(scan.reports[0]?.group)
  })
})

describe('a security code in a password input', () => {
  const html = `
    <form>
      <input id="number" name="cardnumber" autocomplete="cc-number">
      <input id="holder" name="holder" autocomplete="cc-name">
      <input id="cvc" type="password" name="cvc" autocomplete="cc-csc" maxlength="4">
    </form>`

  it('is the card’s, not a login’s password, and no username is found beside it', () => {
    page(html)
    const scan = scanAll()
    expect(kinds(scan)).toEqual(['card:cardNumber', 'card:cardName', 'card:cardCsc'])
    expect([...scan.registry.values()].map((entry) => entry.kind)).toEqual(['card', 'card', 'card'])
  })

  it('is told by its name too, beside a card number', () => {
    page(`
      <form>
        <input name="cardnumber" autocomplete="off">
        <input type="password" name="cvv" autocomplete="off">
      </form>`)
    expect(kinds(scanAll())).toEqual(['card:cardNumber', 'card:cardCsc'])
  })

  it('is not read as a password to save: a sent form has no login in it', async () => {
    page(html)
    const calls: { kind: string; args: unknown }[] = []
    const call = vi.fn(async (kind: string, args: unknown) => {
      calls.push({ kind, args })
      return kind === 'fields' ? { buttons: false } : undefined
    }) as unknown as Call
    const controller = new Controller({
      doc: document,
      call,
      pageUrl: 'chrome-extension://abc/src/menu/index.html',
      label: 'Fill with Kemlock',
      origin: 'https://shop.test',
      isTop: true,
      geometry,
    })
    await controller.scan()
    $('#number').value = '4111111111111111'
    $('#cvc').value = '123'
    const event = new Event('submit', { bubbles: true })
    $('form').dispatchEvent(event)
    controller.submitted(event)
    expect(calls.map((entry) => entry.kind)).toContain('cardSent')
    expect(calls.map((entry) => entry.kind)).not.toContain('sent')
    controller.stop()
  })

  it('stays a login’s password when nothing beside it says it is a card’s', () => {
    page(`
      <input name="email" autocomplete="username">
      <input type="password" name="pw" autocomplete="current-password">`)
    const scan = scanAll()
    expect(kinds(scan)).toEqual(['username:', 'password:'])
  })
})

describe('an identity being sent', () => {
  const form = `
    <form>
      <input id="given" name="fname"><input id="family" name="lname">
      <input id="mail" type="email" autocomplete="email">
      <input id="street" autocomplete="address-line1"><input id="city" autocomplete="address-level2">
      <input id="zip" autocomplete="postal-code">
      <select id="country" autocomplete="country"><option value="FR">France</option></select>
      <button type="submit">Send</button>
    </form>`

  const fill = () => {
    $('#given').value = 'Sam'
    $('#family').value = 'Rivera'
    $('#mail').value = 'sam@example.com'
    $('#street').value = '1 Orbit Way'
    $('#city').value = 'Lyon'
    $('#zip').value = '69001'
  }

  it('is read by its parts, a select by what it shows', () => {
    page(form)
    const { registry } = scanAll()
    fill()
    expect(readIdentity(registry, $('form'))).toEqual({
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
    })
  })

  it('is nothing without a name, or without an email or a street', () => {
    page(form)
    const { registry } = scanAll()
    fill()
    $('#given').value = ''
    $('#family').value = ''
    expect(readIdentity(registry, $('form'))).toBeNull()
    fill()
    $('#mail').value = 'not an address'
    $('#street').value = ''
    expect(readIdentity(registry, $('form'))).toBeNull()
  })

  it('is sent once when the form is submitted', () => {
    page(form)
    const { registry } = scanAll()
    fill()
    const sent: IdentitySent[] = []
    const capture = new IdentityCapture(
      (identity) => sent.push(identity),
      () => geometry,
    )
    const event = new Event('submit', { bubbles: true })
    $('form').dispatchEvent(event)
    capture.submitted(event, registry)
    capture.submitted(event, registry)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.email).toBe('sam@example.com')
  })
})

describe('the top frame vouching for a frame', () => {
  let controller: Controller

  const make = (isTop = true) => {
    const call = vi.fn(async () => undefined) as unknown as Call
    controller = new Controller({
      doc: document,
      call,
      pageUrl: 'chrome-extension://abc/src/menu/index.html',
      label: 'Fill with Kemlock',
      origin: 'https://shop.test',
      isTop,
      geometry,
    })
    return controller
  }
  afterEach(() => controller?.stop())
  const ask = (c: Controller, origin: unknown) => c.handle({ kind: 'frameVisible', origin })

  it('says yes for an iframe of that origin in plain view', () => {
    page('<iframe src="https://pay.example/card"></iframe>')
    expect(ask(make(), 'https://pay.example')).toEqual({ ok: true })
  })

  it('says no for a frame it has none of, or of another origin, or that is not an origin', () => {
    page('<iframe src="https://pay.example/card"></iframe>')
    const c = make()
    expect(ask(c, 'https://other.example')).toEqual({ ok: false })
    expect(ask(c, 42)).toEqual({ ok: false })
    document.body.innerHTML = '<p>no frames</p>'
    expect(ask(c, 'https://pay.example')).toEqual({ ok: false })
  })

  it('says no when the page faded, shrank or moved off a frame it embeds', () => {
    page('<iframe id="f" src="https://pay.example/card" style="opacity: 0.1"></iframe>')
    expect(ask(make(), 'https://pay.example')).toEqual({ ok: false })
    ;($('#f') as unknown as HTMLElement).style.opacity = '1'
    expect(ask(controller, 'https://pay.example')).toEqual({ ok: true })
    const hidden: Geometry = {
      ...geometry,
      rect: () => ({ left: 10, top: 10, width: 1, height: 1 }),
    }
    controller.stop()
    controller = new Controller({
      doc: document,
      call: vi.fn(async () => undefined) as unknown as Call,
      pageUrl: 'chrome-extension://abc/src/menu/index.html',
      label: 'x',
      origin: 'https://shop.test',
      isTop: true,
      geometry: hidden,
    })
    expect(ask(controller, 'https://pay.example')).toEqual({ ok: false })
  })

  it('says no when every iframe of the origin is not in view, and only a top frame answers', () => {
    page(
      '<iframe src="https://pay.example/a"></iframe><iframe src="https://pay.example/b" style="opacity: 0"></iframe>',
    )
    expect(ask(make(), 'https://pay.example')).toEqual({ ok: false })
    page('<iframe src="https://pay.example/a"></iframe>')
    expect(ask(make(false), 'https://pay.example')).toEqual({ ok: false })
  })
})
