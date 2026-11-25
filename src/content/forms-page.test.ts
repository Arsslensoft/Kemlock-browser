// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Controller, type Call } from './controller'
import { fieldNames, type Geometry } from './dom'
import { CardCapture, readCard, type CardSent } from './form-capture'
import { chooseOption, fillFormEntry } from './form-fill'
import { readFormFields } from './formdom'
import { scanFrame, type Registered, type Registry } from './scan'
import { withForms } from './scan-forms'

const geometry: Geometry = {
  rect: () => ({ left: 10, top: 10, width: 200, height: 30 }),
  elementsAt: () => [],
  viewport: () => ({ width: 1280, height: 800 }),
}

const page = (html: string) => {
  document.body.innerHTML = html
}
const $ = <T extends Element = HTMLInputElement>(selector: string) =>
  document.querySelector(selector) as T

const checkout = `
  <form id="pay">
    <label>Name on card <input name="holder" autocomplete="cc-name"></label>
    <input name="cardnumber" autocomplete="cc-number" inputmode="numeric">
    <select name="month" autocomplete="cc-exp-month">
      <option value="">Month</option><option value="01">01 - January</option><option value="05">05 - May</option>
    </select>
    <select name="year" autocomplete="cc-exp-year">
      <option value="">Year</option><option value="2028">2028</option><option value="2029">2029</option>
    </select>
    <input name="cvc" autocomplete="cc-csc" maxlength="4">
    <button type="submit">Pay</button>
  </form>`

/** The frame scanned the way the controller does: the sign-in rules first, then the card and identity rules. */
function scanAll(): { registry: Registry; reports: ReturnType<typeof withForms>['reports'] } {
  const names = fieldNames()
  const found = scanFrame(document, names, geometry)
  const { registry, reports } = withForms(found, document, names, geometry)
  return {
    registry,
    reports: reports.filter((report) => report.kind === 'card' || report.kind === 'identity'),
  }
}

const entry = (registry: Registry, part: string): Registered =>
  [...registry.values()].find((candidate) => candidate.part === part)!

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readFormFields', () => {
  it('reads inputs, selects and text areas, with their block and their format', () => {
    page(`
      <form><input name="a" placeholder="MM / YYYY" maxlength="7"></form>
      <form>
        <select name="b"><option>x</option></select>
        <textarea name="c" autocomplete="shipping street-address"></textarea>
        <input type="checkbox" name="d"><input type="hidden" name="e"><input type="date" name="f">
      </form>`)
    const fields = readFormFields(document, fieldNames(), geometry)
    expect(fields.map((field) => [field.id, field.tag, field.group, field.format])).toEqual([
      ['f1', 'input', '1', 'len:7;year:4;sep:/'],
      ['f2', 'select', '2', 'select'],
      ['f3', 'textarea', '2:shipping', 'area'],
      ['f4', 'input', '2', 'date'],
    ])
    expect(fields[2]?.autocomplete).toEqual(['shipping', 'street-address'])
    expect(fields[0]?.words).toEqual(['a', 'MM / YYYY'])
  })

  it('writes the year and the separator its placeholder shows', () => {
    page(`
      <input name="a" placeholder="MM/YY"><input name="b" placeholder="MM-AAAA">
      <input name="c" placeholder="MMYY" maxlength="4">`)
    expect(readFormFields(document, fieldNames(), geometry).map((field) => field.format)).toEqual([
      'year:2;sep:/',
      'year:4;sep:-',
      'len:4;year:2;sep:n',
    ])
  })
})

describe('scanForms', () => {
  it('reports a checkout form’s card fields, whatever they are, once each', () => {
    page(checkout)
    const { reports } = scanAll()
    expect(reports.map((report) => [report.kind, report.part])).toEqual([
      ['card', 'cardName'],
      ['card', 'cardNumber'],
      ['card', 'cardExpMonth'],
      ['card', 'cardExpYear'],
      ['card', 'cardCsc'],
    ])
    expect(reports.every((report) => report.group === '1')).toBe(true)
  })

  it('leaves a sign-in form to the sign-in rules', () => {
    page(`
      <input name="email" type="email" autocomplete="username">
      <input type="password" name="pw" autocomplete="current-password">`)
    expect(scanAll().reports).toEqual([])
  })

  it('takes a code field that is plainly a security code', () => {
    page(`
      <input name="number" autocomplete="cc-number">
      <input name="sec" aria-label="Security code" inputmode="numeric" maxlength="4" autocomplete="cc-csc">`)
    const { registry, reports } = scanAll()
    expect(reports.map((report) => report.part)).toEqual(['cardNumber', 'cardCsc'])
    expect(entry(registry, 'cardCsc').kind).toBe('card')
  })

  it('takes an email for the identity when the frame has no password, and leaves it to the sign-in when there is a password', () => {
    page(`
      <input name="fname"><input name="lname"><input type="email" name="mail" autocomplete="email">`)
    expect(scanAll().reports.map((report) => report.part)).toEqual([
      'givenName',
      'familyName',
      'email',
    ])
    // Alone, an email is still a sign-in's first step
    page('<input type="email" name="mail" autocomplete="email">')
    expect(scanAll().reports).toEqual([])
    // With a password in the frame it is the sign-in's username, beside a name or not
    page(`
      <input name="fname"><input name="lname"><input type="email" name="mail" autocomplete="username">
      <input type="password" name="pw" autocomplete="new-password">`)
    expect(scanAll().reports.map((report) => report.part)).toEqual(['givenName', 'familyName'])
  })

  it('finds an address form and gives each select its own place', () => {
    page(`
      <form>
        <input name="fname"><input name="lname"><input name="address1">
        <input name="postcode"><select name="country"><option value="FR">France</option></select>
      </form>`)
    expect(scanAll().reports.map((report) => report.part)).toEqual([
      'givenName',
      'familyName',
      'line1',
      'postalCode',
      'countryName',
    ])
  })
})

describe('choosing an option', () => {
  const select = (options: string) => {
    page(`<select>${options}</select>`)
    return $<HTMLSelectElement>('select')
  }

  it('finds a month by its value, its number or its words', () => {
    const months = select(
      '<option value="">Month</option><option value="1">January</option><option value="5">May</option>',
    )
    expect(chooseOption(months, '05', ['5', 'May', 'mai'])?.value).toBe('5')
    const words = select('<option>01 - January</option><option>05 - May</option>')
    expect(chooseOption(words, '05', [])?.text).toBe('05 - May')
    expect(chooseOption(words, '5', ['May'])?.text).toBe('05 - May')
    const names = select('<option>January</option><option>mai</option>')
    expect(chooseOption(names, '05', ['May', 'mai'])?.text).toBe('mai')
  })

  it('finds a year as four digits or two', () => {
    const years = select('<option value="28">28</option><option value="29">29</option>')
    expect(chooseOption(years, '2029', ['29'])?.value).toBe('29')
  })

  it('finds a country by its code or either name, accents aside', () => {
    const countries = select(
      '<option value="">Choose</option><option value="DE">Allemagne</option><option value="FR">République française (France)</option><option value="CI">Côte d’Ivoire</option>',
    )
    expect(chooseOption(countries, 'DE', ['Germany', 'Allemagne'])?.value).toBe('DE')
    expect(chooseOption(countries, 'Cote d’Ivoire', [])?.value).toBe('CI')
    const names = select('<option>France</option><option>Germany</option>')
    expect(chooseOption(names, 'FR', ['France'])?.text).toBe('France')
  })

  it('never chooses the empty option, a disabled one, or an option that is not there', () => {
    const one = select(
      '<option value="">France</option><option value="FR" disabled>France</option>',
    )
    expect(chooseOption(one, 'France', ['FR'])).toBeUndefined()
    expect(chooseOption(select('<option>05</option>'), '07', ['7'])).toBeUndefined()
    expect(chooseOption(select('<option>050</option>'), '05', [])).toBeUndefined()
  })
})

describe('fillFormEntry', () => {
  const value = (element: Element) => (element as HTMLInputElement).value

  it('fills a text field as typing would, and fires input and change', () => {
    page(checkout)
    const { registry } = scanAll()
    const seen: string[] = []
    const input = $('[name=cardnumber]')
    input.addEventListener('input', () => seen.push('input'))
    input.addEventListener('change', () => seen.push('change'))
    expect(fillFormEntry(entry(registry, 'cardNumber'), '4111111111111111', [], geometry)).toBe(
      true,
    )
    expect(value(input)).toBe('4111111111111111')
    expect(seen).toEqual(['input', 'change'])
  })

  it('chooses the option a select’s value names', () => {
    page(checkout)
    const { registry } = scanAll()
    expect(fillFormEntry(entry(registry, 'cardExpMonth'), '05', ['5'], geometry)).toBe(true)
    expect(fillFormEntry(entry(registry, 'cardExpYear'), '2029', ['29'], geometry)).toBe(true)
    expect(value($('[name=month]'))).toBe('05')
    expect(value($('[name=year]'))).toBe('2029')
    // A month the select doesn't have leaves it as it is
    expect(fillFormEntry(entry(registry, 'cardExpMonth'), '09', ['9'], geometry)).toBe(false)
    expect(value($('[name=month]'))).toBe('05')
  })

  it('fills a text area, and refuses a read-only field, a hidden one and one that went', () => {
    page(`
      <textarea name="street" autocomplete="street-address"></textarea>
      <input name="given" autocomplete="given-name" readonly>
      <input name="family" autocomplete="family-name">`)
    const { registry } = scanAll()
    expect(fillFormEntry(entry(registry, 'street'), '1 Orbit Way\nFloor 2', [], geometry)).toBe(
      true,
    )
    expect(value($('textarea'))).toBe('1 Orbit Way\nFloor 2')
    expect(fillFormEntry(entry(registry, 'givenName'), 'Sam', [], geometry)).toBe(false)
    $('[name=family]').style.opacity = '0'
    expect(fillFormEntry(entry(registry, 'familyName'), 'Rivera', [], geometry)).toBe(false)
    $('textarea').remove()
    expect(fillFormEntry(entry(registry, 'street'), 'x', [], geometry)).toBe(false)
  })
})

describe('readCard', () => {
  it('reads the card fields of a form, with the number as digits', () => {
    page(checkout)
    const { registry } = scanAll()
    $('[name=holder]').value = 'Sam Rivera'
    $('[name=cardnumber]').value = '4111 1111-1111 1111'
    $<HTMLSelectElement>('[name=month]').value = '05'
    $<HTMLSelectElement>('[name=year]').value = '2029'
    $('[name=cvc]').value = '123'
    expect(readCard(registry, $('form'))).toEqual({
      number: '4111111111111111',
      holder: 'Sam Rivera',
      expiry: '',
      month: '05',
      year: '2029',
      code: '123',
    })
  })

  it('reads a month a select shows by its words', () => {
    page(
      '<input name="n" autocomplete="cc-number"><select name="m" autocomplete="cc-exp-month"><option value="may">05 - May</option></select>',
    )
    const { registry } = scanAll()
    $('[name=n]').value = '4111111111111111'
    $<HTMLSelectElement>('[name=m]').value = 'may'
    expect(readCard(registry, null)?.month).toBe('05')
  })

  it('is nothing unless the number is plainly a card number', () => {
    page(checkout)
    const { registry } = scanAll()
    for (const number of ['', '4111', '4111111111111112', '41111111111111111111', 'abcd']) {
      $('[name=cardnumber]').value = number
      expect(readCard(registry, $('form')), number).toBeNull()
    }
  })
})

describe('CardCapture', () => {
  let sent: CardSent[]
  let now = 1000
  const make = () =>
    new CardCapture(
      (card) => sent.push(card),
      () => geometry,
      () => now,
    )

  beforeEach(() => {
    sent = []
    now = 1000
  })

  const fillIn = () => {
    page(checkout)
    const scan = scanAll()
    $('[name=cardnumber]').value = '4111111111111111'
    $('[name=cvc]').value = '123'
    return scan.registry
  }

  it('sends a form the page submitted, once', () => {
    const registry = fillIn()
    const capture = make()
    const event = new Event('submit', { bubbles: true })
    $('form').dispatchEvent(event)
    capture.submitted(event, registry)
    capture.submitted(event, registry)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.number).toBe('4111111111111111')
    // The same card again, later, is sent again
    now += 5000
    capture.submitted(event, registry)
    expect(sent).toHaveLength(2)
  })

  /** Presses the button, with the capture listening as the page's own listener would. */
  const press = (capture: CardCapture, registry: Registry) => {
    const button = $('button')
    const listen = (event: Event) => capture.pressed(event as MouseEvent, registry, document)
    button.addEventListener('click', listen)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    button.removeEventListener('click', listen)
  }

  it('sends a press on a button when the page then navigates, and not otherwise', () => {
    const registry = fillIn()
    const capture = make()
    press(capture, registry)
    expect(sent).toEqual([])
    capture.navigated()
    expect(sent).toHaveLength(1)
    // A press whose time ran out is not a send
    press(capture, registry)
    now += 60_000
    capture.navigated()
    expect(sent).toHaveLength(1)
  })

  it('sends a press when the form goes from the page', () => {
    const registry = fillIn()
    const capture = make()
    press(capture, registry)
    capture.afterScan()
    expect(sent).toEqual([])
    $('form').remove()
    capture.afterScan()
    expect(sent).toHaveLength(1)
  })

  it('sends nothing for a page with no card in it', () => {
    page('<form><input name="q"><button>Go</button></form>')
    const capture = make()
    press(capture, new Map())
    capture.navigated()
    expect(sent).toEqual([])
  })
})

describe('the controller on a checkout form', () => {
  let calls: { kind: string; args: unknown }[]
  let controller: Controller

  function make() {
    const call = vi.fn(async (kind: string, args: unknown) => {
      calls.push({ kind, args })
      if (kind === 'fields') return { buttons: true }
      if (kind === 'frame') return { tabId: 4, frameId: 0 }
      return undefined
    }) as unknown as Call
    controller = new Controller({
      doc: document,
      call,
      pageUrl: 'chrome-extension://abc/src/menu/index.html',
      label: 'Fill with Kemlock',
      origin: 'https://shop.test',
      isTop: true,
      geometry,
    })
    return controller
  }

  beforeEach(() => {
    calls = []
  })
  afterEach(() => controller?.stop())

  it('reports the card fields with what each asks for, and puts one button on the form', async () => {
    page(checkout)
    const before = document.body.children.length
    await make().scan()
    expect(calls[0]?.args).toEqual({
      fields: [
        // The inputs are named first, by the sign-in rules, and the selects after them
        { id: 'f1', kind: 'card', part: 'cardName', group: '1' },
        { id: 'f2', kind: 'card', part: 'cardNumber', group: '1' },
        { id: 'f4', kind: 'card', part: 'cardExpMonth', group: '1', rules: 'select' },
        { id: 'f5', kind: 'card', part: 'cardExpYear', group: '1', rules: 'select' },
        { id: 'f3', kind: 'card', part: 'cardCsc', group: '1', rules: 'len:4' },
      ],
    })
    // The first field of the block, not every field
    expect(document.body.children.length - before).toBe(1)
  })

  it('moves the button to the field the person is in', async () => {
    page(checkout)
    const c = make()
    await c.scan()
    const before = document.body.children.length
    $('[name=cvc]').focus()
    await c.scan()
    expect(document.body.children.length).toBe(before + 1)
  })

  it('fills a text field, a select by its option and a text area, and refuses what it never registered', async () => {
    page(checkout)
    const c = make()
    await c.scan()
    expect(c.handle({ kind: 'fill', fieldId: 'f2', value: '4111111111111111' })).toEqual({
      ok: true,
    })
    expect($('[name=cardnumber]').value).toBe('4111111111111111')
    expect(
      c.handle({
        kind: 'fill',
        fieldId: 'f4',
        value: '05',
        alt: ['5', 'May'],
        origin: 'https://shop.test',
      }),
    ).toEqual({ ok: true })
    expect($<HTMLSelectElement>('[name=month]').value).toBe('05')
    expect(c.handle({ kind: 'fill', fieldId: 'f4', value: '09', alt: [] })).toEqual({ ok: false })
    expect(
      c.handle({ kind: 'fill', fieldId: 'f2', value: 'x', origin: 'https://evil.test' }),
    ).toEqual({ ok: false })
    expect(c.handle({ kind: 'fill', fieldId: 'f9', value: 'x' })).toEqual({ ok: false })
    // What a message may carry as other values is a few short texts
    expect(c.handle({ kind: 'fill', fieldId: 'f4', value: '01', alt: 'nope' })).toEqual({
      ok: true,
    })
  })

  it('answers a right-click on a card field with its part and its block', async () => {
    page(checkout)
    const c = make()
    await c.scan()
    c.contextMenu({ composedPath: () => [$('[name=cardnumber]')] } as unknown as MouseEvent)
    expect(c.contextTarget()).toEqual({
      fieldId: 'f2',
      kind: 'card',
      part: 'cardNumber',
      group: '1',
    })
  })

  it('says a card was sent, when the form is submitted with a card number in it', async () => {
    page(checkout)
    const c = make()
    await c.scan()
    $('[name=cardnumber]').value = '4111111111111111'
    const event = new Event('submit', { bubbles: true })
    $('form').dispatchEvent(event)
    c.submitted(event)
    expect(calls.find((call) => call.kind === 'cardSent')?.args).toMatchObject({
      number: '4111111111111111',
    })
  })

  it('leaves a sign-in form’s button on each of its fields, and puts none on a form with no card', async () => {
    page(`
      <input name="email" autocomplete="username">
      <input type="password" name="pw" autocomplete="current-password">`)
    const before = document.body.children.length
    await make().scan()
    expect(document.body.children.length - before).toBe(2)
  })
})
