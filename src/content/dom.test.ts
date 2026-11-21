// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fieldNames, readFields, type Geometry } from './dom'
import { findCodeFields, findLoginFields } from './fields'

/** A layout for jsdom, which has none: each field a box in view, unless a test moves it off screen. */
function layout(offScreen: Element[] = []): Geometry {
  return {
    rect: (element) =>
      offScreen.includes(element)
        ? { left: -10000, top: 0, width: 200, height: 30 }
        : { left: 10, top: 10, width: 200, height: 30 },
    elementsAt: () => [],
    viewport: () => ({ width: 1280, height: 800 }),
  }
}

function page(html: string) {
  document.body.innerHTML = html
}

const $ = (selector: string) => document.querySelector(selector) as HTMLInputElement

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readFields', () => {
  it('reads what a field says, its labels and what screen readers read', () => {
    page(`
      <label for="email">Work email</label>
      <input id="email" name="login" placeholder="you@example.com" autocomplete="Username email">
      <span id="hint">Six digits from your app</span>
      <input name="otp" inputmode="Numeric" maxlength="6" aria-label="Code" aria-labelledby="hint">
      <label>Password <input type="password" name="pw" passwordrules="minlength: 12;"></label>`)
    const names = fieldNames()
    const fields = readFields(document, names, layout())
    expect(fields).toEqual([
      {
        id: 'f1',
        tag: 'input',
        type: 'text',
        autocomplete: ['username', 'email'],
        words: ['login', 'email', 'you@example.com', 'Work email'],
        visible: true,
        focused: false,
      },
      {
        id: 'f2',
        tag: 'input',
        type: 'text',
        autocomplete: [],
        inputMode: 'numeric',
        maxLength: 6,
        words: ['otp', 'Code', 'Six digits from your app'],
        visible: true,
        focused: false,
      },
      {
        id: 'f3',
        tag: 'input',
        type: 'password',
        autocomplete: [],
        words: ['pw', 'Password'],
        passwordRules: 'minlength: 12;',
        visible: true,
        focused: false,
      },
    ])
    // A field keeps its name while the page lives
    expect(names($('[name=pw]'))).toBe('f3')
  })

  it('leaves out inputs that take no text, and says which field is in focus', () => {
    page(`
      <input type="hidden" name="csrf" value="x">
      <input type="checkbox" name="remember">
      <input type="submit" value="Sign in">
      <input name="user">`)
    $('[name=user]').focus()
    const fields = readFields(document, fieldNames(), layout())
    expect(fields.map((f) => [f.words[0], f.focused])).toEqual([['user', true]])
  })

  it('reads fields inside an open shadow root', () => {
    page('<sign-in-form></sign-in-form>')
    const shadow = document.querySelector('sign-in-form')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<label for="c">Verification code</label><input id="c" inputmode="numeric">'
    const fields = readFields(document, fieldNames(), layout())
    expect(fields.map((f) => f.words)).toEqual([['c', 'Verification code']])
    expect(findCodeFields(fields)).toEqual([{ id: 'f1', character: null }])
  })
})

describe('the page, read and judged', () => {
  const read = (geometry = layout()) => readFields(document, fieldNames(), geometry)

  it('finds a code field by its aria-label', () => {
    page('<input name="field_7" inputmode="numeric" aria-label="Two-factor code">')
    expect(findCodeFields(read())).toEqual([{ id: 'f1', character: null }])
  })

  it('finds a code field by its label', () => {
    page('<label for="c">Code de vérification</label><input id="c" maxlength="6">')
    expect(findCodeFields(read())).toEqual([{ id: 'f1', character: null }])
  })

  it('puts a digit in each of six boxes', () => {
    page(Array.from({ length: 6 }, () => '<input maxlength="1" inputmode="numeric">').join(''))
    expect(findCodeFields(read())).toEqual(
      Array.from({ length: 6 }, (_, i) => ({ id: `f${i + 1}`, character: i })),
    )
  })

  it('leaves recovery and backup code fields alone', () => {
    page(`
      <label for="r">Recovery code</label><input id="r" maxlength="10">
      <input name="backup_code" inputmode="numeric" maxlength="8">
      <input name="code_secours" maxlength="8">`)
    expect(findCodeFields(read())).toEqual([])
  })

  it('leaves hidden fields alone, however they are hidden', () => {
    page(`
      <input name="otp" style="display: none">
      <div style="display: none"><input name="otp"></div>
      <div style="visibility: hidden"><input name="otp"></div>
      <div style="opacity: 0.3"><div style="opacity: 0.2"><input name="otp"></div></div>
      <input name="otp" class="moved">
      <input name="otp" class="covered"><div class="cover"></div>`)
    const geometry = layout([$('.moved')])
    const covered = $('.covered')
    const cover = document.querySelector('.cover')!
    const withCover: Geometry = {
      ...geometry,
      elementsAt: () => [cover],
      rect: (element) =>
        element === covered
          ? { left: 10, top: 300, width: 200, height: 30 }
          : geometry.rect(element),
    }
    const fields = read(withCover)
    expect(fields.map((f) => f.visible)).toEqual([false, false, false, false, false, false])
    expect(findCodeFields(fields)).toEqual([])
  })

  it('takes a field faded only a little as visible', () => {
    page('<div style="opacity: 0.5"><input name="otp"></div>')
    expect(read()[0].visible).toBe(true)
  })

  it('takes a field whose label is on top at its centre as visible', () => {
    page('<label><span>Code</span><input name="otp"></label>')
    const label = document.querySelector('label')!
    expect(read({ ...layout(), elementsAt: () => [label] })[0].visible).toBe(true)
  })

  it('reads a sign-in in two steps: the email first, then the password', () => {
    page('<input type="email" name="identifier" autocomplete="username"><button>Next</button>')
    expect(findLoginFields(read())).toMatchObject({ username: 'f1', password: null })
    page(
      '<input type="password" name="Passwd" autocomplete="current-password"><button>Sign in</button>',
    )
    expect(findLoginFields(read())).toMatchObject({
      username: null,
      password: 'f1',
      newPasswords: [],
    })
  })

  it("doesn't take an email field alone for a username when it doesn't say so", () => {
    page('<input type="email" name="newsletter">')
    expect(findLoginFields(read())).toMatchObject({ username: null, password: null })
  })

  it('tells a sign-up form: the username, a new password and its confirmation', () => {
    page(`
      <input name="user" placeholder="Username">
      <input type="password" name="password" maxlength="32">
      <input type="password" name="confirm_password" maxlength="64">`)
    expect(findLoginFields(read())).toEqual({
      username: 'f1',
      password: null,
      newPasswords: ['f2', 'f3'],
      focused: null,
      newPasswordMaxLength: 32,
      newPasswordRules: null,
    })
  })
})
