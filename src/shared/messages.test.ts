import { describe, expect, it } from 'vitest'
import { fillRefused, parseContentMessage, parseContextTarget, parsePageMessage } from './messages'

describe('parseContentMessage', () => {
  it('keeps the known fields only', () => {
    expect(
      parseContentMessage({
        kind: 'fields',
        url: 'https://bank.example',
        fields: [
          { id: 'user', kind: 'username', label: 'Email' },
          { id: 'otp', kind: 'code', boxes: 6 },
          { id: 'pw2', kind: 'newPassword', rules: 'maxlength: 16' },
        ],
      }),
    ).toEqual({
      kind: 'fields',
      fields: [
        { id: 'user', kind: 'username' },
        { id: 'otp', kind: 'code', boxes: 6 },
        { id: 'pw2', kind: 'newPassword', rules: 'maxlength: 16' },
      ],
    })
    expect(
      parseContentMessage({ kind: 'openMenu', fieldId: 'user', origin: 'https://bank.example' }),
    ).toEqual({ kind: 'openMenu', fieldId: 'user' })
    expect(
      parseContentMessage({ kind: 'sent', username: 'sam', password: 'pw', host: 'evil.example' }),
    ).toEqual({ kind: 'sent', username: 'sam', password: 'pw' })
    expect(
      parseContentMessage({ kind: 'sent', username: 'sam', password: 'old', newPassword: 'new' }),
    ).toEqual({ kind: 'sent', username: 'sam', password: 'old', newPassword: 'new' })
  })

  it('refuses what is not a field report', () => {
    const field = { id: 'f', kind: 'password' }
    for (const raw of [
      null,
      'fields',
      [],
      { kind: 'fill', fieldId: 'f', value: 'x' },
      { kind: 'suggestions' },
      { kind: 'constructor' },
      { kind: '__proto__' },
      { kind: 'fields' },
      { kind: 'fields', fields: [{ ...field, kind: 'creditCard' }] },
      { kind: 'fields', fields: [{ ...field, id: '' }] },
      { kind: 'fields', fields: [{ ...field, id: 'x'.repeat(65) }] },
      { kind: 'fields', fields: [field, field] },
      { kind: 'fields', fields: [{ ...field, boxes: 6 }] },
      { kind: 'fields', fields: [{ ...field, rules: 'x'.repeat(513) }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 3 }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 11 }] },
      { kind: 'fields', fields: [{ id: 'c', kind: 'code', boxes: 6.5 }] },
      {
        kind: 'fields',
        fields: Array.from({ length: 201 }, (_, i) => ({ ...field, id: `f${i}` })),
      },
      { kind: 'sent', username: 'sam' },
      { kind: 'sent', username: 'sam', password: 12 },
      { kind: 'sent', username: 'sam', password: 'x'.repeat(4097) },
      { kind: 'openMenu' },
      { kind: 'openMenu', fieldId: 7 },
      { kind: 'openMenu', fieldId: 'x'.repeat(65) },
    ]) {
      expect(parseContentMessage(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull()
    }
  })

  it('takes up to 200 fields', () => {
    const fields = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, kind: 'password' }))
    expect(parseContentMessage({ kind: 'fields', fields })).toEqual({ kind: 'fields', fields })
  })

  it('does not take what the page messages are', () => {
    expect(parseContentMessage({ kind: 'unlock', password: 'pw' })).toBeNull()
    expect(parseContentMessage({ kind: 'popup' })).toBeNull()
  })
})

describe('parsePageMessage', () => {
  it('reads the pages messages, with the known fields only', () => {
    expect(parsePageMessage({ kind: 'popup', extra: 1 })).toEqual({ kind: 'popup' })
    expect(parsePageMessage({ kind: 'lock' })).toEqual({ kind: 'lock' })
    expect(parsePageMessage({ kind: 'unlock', password: 'correct horse', url: 'x' })).toEqual({
      kind: 'unlock',
      password: 'correct horse',
    })
    expect(parsePageMessage({ kind: 'liveCodes', ids: ['a', 'b'] })).toEqual({
      kind: 'liveCodes',
      ids: ['a', 'b'],
    })
    expect(
      parsePageMessage({
        kind: 'fill',
        tabId: 7,
        frameId: 0,
        fieldId: 'f1',
        loginId: 'l1',
        evil: true,
      }),
    ).toEqual({ kind: 'fill', tabId: 7, frameId: 0, fieldId: 'f1', loginId: 'l1' })
    expect(parsePageMessage({ kind: 'fill', tabId: 7, newPassword: 'p', remember: true })).toEqual({
      kind: 'fill',
      tabId: 7,
      newPassword: 'p',
      remember: true,
    })
    expect(parsePageMessage({ kind: 'menu', tabId: 7, frameId: 2, fieldId: 'f' })).toEqual({
      kind: 'menu',
      tabId: 7,
      frameId: 2,
      fieldId: 'f',
    })
    expect(parsePageMessage({ kind: 'answerSave', tabId: 7, save: false, never: true })).toEqual({
      kind: 'answerSave',
      tabId: 7,
      save: false,
      never: true,
    })
    expect(
      parsePageMessage({ kind: 'copy', what: 'generated', id: '', value: 'pw', more: 1 }),
    ).toEqual({ kind: 'copy', what: 'generated', id: '', value: 'pw' })
  })

  it('reads a login to save, and what it may hold', () => {
    const input = {
      name: 'Orbit Cloud',
      username: 'sam',
      password: 'pw',
      websites: ['orbit-cloud.com'],
      note: 'n',
      tags: ['work'],
      order: 5,
    }
    expect(parsePageMessage({ kind: 'saveLogin', id: null, input })).toEqual({
      kind: 'saveLogin',
      id: null,
      input: {
        name: 'Orbit Cloud',
        username: 'sam',
        password: 'pw',
        websites: ['orbit-cloud.com'],
        note: 'n',
        tags: ['work'],
      },
    })
    expect(
      parsePageMessage({ kind: 'saveLogin', id: 'l1', input: { ...input, websites: [] } }),
    ).not.toBeNull()
    for (const bigger of [
      { ...input, websites: Array.from({ length: 51 }, () => 'a.example') },
      { ...input, websites: [7] },
      { ...input, name: 'x'.repeat(513) },
      { ...input, note: 'x'.repeat(20_001) },
      { ...input, tags: [''] },
      { ...input, password: undefined },
    ]) {
      expect(parsePageMessage({ kind: 'saveLogin', id: null, input: bigger })).toBeNull()
    }
    expect(parsePageMessage({ kind: 'saveLogin', input })).toBeNull()
  })

  it('reads the generator choices and the settings, in their ranges', () => {
    expect(
      parsePageMessage({
        kind: 'generate',
        options: { mode: 'random', length: 20, symbols: true, junk: 1 },
      }),
    ).toEqual({ kind: 'generate', options: { mode: 'random', length: 20, symbols: true } })
    for (const options of [
      { mode: 'random', length: 7 },
      { mode: 'random', length: 129 },
      { mode: 'passphrase', words: 2 },
      { mode: 'passphrase', words: 21 },
      { mode: 'words' },
      { mode: 'random', separator: 'x'.repeat(9) },
    ]) {
      expect(parsePageMessage({ kind: 'generate', options })).toBeNull()
    }
    expect(
      parsePageMessage({ kind: 'saveSettings', settings: { autoLockMinutes: 15, other: 1 } }),
    ).toEqual({ kind: 'saveSettings', settings: { autoLockMinutes: 15 } })
    expect(parsePageMessage({ kind: 'saveSettings', settings: {} })).toEqual({
      kind: 'saveSettings',
      settings: {},
    })
    for (const settings of [
      { autoLockMinutes: 3 },
      { clipboardSeconds: 31 },
      { lockOnSleep: 'yes' },
    ]) {
      expect(parsePageMessage({ kind: 'saveSettings', settings })).toBeNull()
    }
  })

  it("reads each sign-in step's answer", () => {
    for (const answer of [
      { step: 'second', method: 'authenticator', code: '123456', remember: true },
      { step: 'securityKey', assertion: 'abc', remember: false },
      { step: 'approval', requestId: 'r1' },
      { step: 'masterPassword', password: 'pw' },
      { step: 'homes', homeId: 'h1' },
      { step: 'passphrase', passphrase: 'pp' },
      { step: 'firstSync', go: true },
    ]) {
      expect(parsePageMessage({ kind: 'answerStep', answer: { ...answer, extra: 1 } })).toEqual({
        kind: 'answerStep',
        answer,
      })
    }
    for (const answer of [
      { step: 'second', method: 'sms', code: '1', remember: true },
      { step: 'second', method: 'email', code: '1' },
      { step: 'firstSync' },
      { step: 'done' },
      { step: 'constructor' },
      'approval',
    ]) {
      expect(parsePageMessage({ kind: 'answerStep', answer })).toBeNull()
    }
  })

  it('reads the server check and the security key request', () => {
    expect(
      parsePageMessage({
        kind: 'checkServer',
        place: 'kemlock',
        server: 'https://k.example',
        x: 1,
      }),
    ).toEqual({ kind: 'checkServer', place: 'kemlock', server: 'https://k.example' })
    expect(
      parsePageMessage({ kind: 'checkServer', place: 'webdav', server: 'https://k.example' }),
    ).toBeNull()
    expect(parsePageMessage({ kind: 'securityKeyChallenge', extra: 1 })).toEqual({
      kind: 'securityKeyChallenge',
    })
    // Email's second step asks to send the email: the code is empty
    expect(
      parsePageMessage({
        kind: 'answerStep',
        answer: { step: 'second', method: 'email', code: '', remember: false },
      }),
    ).not.toBeNull()
  })

  it('reads what the popup asks besides', () => {
    expect(parsePageMessage({ kind: 'nextCodes', ids: ['a'], x: 1 })).toEqual({
      kind: 'nextCodes',
      ids: ['a'],
    })
    expect(parsePageMessage({ kind: 'useBackupCode', serviceId: 'orbit' })).not.toBeNull()
    expect(parsePageMessage({ kind: 'useBackupCode' })).toBeNull()
    expect(parsePageMessage({ kind: 'rememberedSites', loginId: 'l' })).not.toBeNull()
    expect(parsePageMessage({ kind: 'forgetSite', loginId: 'l', host: 'a.example' })).not.toBeNull()
    expect(parsePageMessage({ kind: 'forgetSite', loginId: 'l', host: '' })).toBeNull()
    expect(
      parsePageMessage({ kind: 'generate', options: { mode: 'random', avoidLookAlikes: false } }),
    ).toEqual({ kind: 'generate', options: { mode: 'random', avoidLookAlikes: false } })
  })

  it('reads the sign-ins', () => {
    expect(
      parsePageMessage({
        kind: 'signInKemlock',
        server: 'https://kemlock.example',
        email: 'sam@example.com',
        password: 'pw',
        token: 'x',
      }),
    ).toEqual({
      kind: 'signInKemlock',
      server: 'https://kemlock.example',
      email: 'sam@example.com',
      password: 'pw',
    })
    expect(
      parsePageMessage({
        kind: 'signInWebdav',
        folder: 'https://dav.example/k',
        username: 'u',
        password: 'p',
      }),
    ).not.toBeNull()
    expect(parsePageMessage({ kind: 'signInVaultwarden', server: 'https://vw.example' })).toBeNull()
  })

  it('takes http(s) addresses only, leaving http for the core to refuse, and no marking of a login as autofilled', () => {
    expect(
      parsePageMessage({
        kind: 'signInKemlock',
        server: 'http://k.example',
        email: 'a@b.c',
        password: 'p',
      }),
    ).not.toBeNull()
    for (const server of ['ftp://k.example', 'k.example', 'javascript:1']) {
      expect(parsePageMessage({ kind: 'checkServer', place: 'kemlock', server })).toBeNull()
      expect(
        parsePageMessage({ kind: 'signInKemlock', server, email: 'a@b.c', password: 'p' }),
      ).toBeNull()
      expect(
        parsePageMessage({ kind: 'signInVaultwarden', server, email: 'a@b.c', password: 'p' }),
      ).toBeNull()
      expect(
        parsePageMessage({ kind: 'signInWebdav', folder: server, username: 'u', password: 'p' }),
      ).toBeNull()
    }
    expect(
      parsePageMessage({
        kind: 'saveLogin',
        id: null,
        input: { name: 'n', username: 'u', password: 'p', websites: [], fromAutofill: true },
      }),
    ).toEqual({
      kind: 'saveLogin',
      id: null,
      input: { name: 'n', username: 'u', password: 'p', websites: [] },
    })
  })

  it('refuses what is malformed or out of bounds', () => {
    for (const raw of [
      undefined,
      'popup',
      [],
      { kind: 'suggestions' },
      { kind: 'state' },
      { kind: 'toString' },
      { kind: 'unlock' },
      { kind: 'unlock', password: 1234 },
      { kind: 'unlock', password: 'x'.repeat(4097) },
      { kind: 'liveCodes', ids: 'a' },
      { kind: 'liveCodes', ids: Array.from({ length: 501 }, (_, i) => `c${i}`) },
      { kind: 'liveCodes', ids: [''] },
      { kind: 'fill', tabId: -1 },
      { kind: 'fill', tabId: 1.5 },
      { kind: 'fill', tabId: '7' },
      { kind: 'fill', tabId: 7, frameId: -1 },
      { kind: 'menu', tabId: 7, frameId: 0 },
      { kind: 'copy', what: 'secret', id: 'a' },
      { kind: 'copy', what: 'code' },
      { kind: 'answerSave', tabId: 7 },
      { kind: 'addCodeFromLink', otpauth: '' },
      { kind: 'linkCode', codeId: 'c' },
    ]) {
      expect(parsePageMessage(raw), JSON.stringify(raw)?.slice(0, 80)).toBeNull()
    }
  })

  it('does not take what a content script may send', () => {
    expect(parsePageMessage({ kind: 'fields', fields: [] })).toBeNull()
    expect(parsePageMessage({ kind: 'openMenu', fieldId: 'f' })).toBeNull()
    expect(parsePageMessage({ kind: 'sent', username: 'a', password: 'b' })).toBeNull()
  })

  it('keeps null ids and optional ones apart', () => {
    expect(parsePageMessage({ kind: 'linkCode', codeId: 'c', loginId: null })).toEqual({
      kind: 'linkCode',
      codeId: 'c',
      loginId: null,
    })
    expect(parsePageMessage({ kind: 'addCodeFromTab', tabId: 3 })).toEqual({
      kind: 'addCodeFromTab',
      tabId: 3,
    })
  })
})

describe('the answers a frame gives', () => {
  it('reads the right-click target a frame names', () => {
    expect(parseContextTarget({ fieldId: 'f', kind: 'code', boxes: 6, x: 1 })).toEqual({
      fieldId: 'f',
      kind: 'code',
      boxes: 6,
    })
    expect(parseContextTarget(null)).toBeNull()
    expect(parseContextTarget(undefined)).toBeNull()
    expect(parseContextTarget({ fieldId: 'f', kind: 'password', boxes: 6 })).toBeNull()
    expect(parseContextTarget({ fieldId: '', kind: 'password' })).toBeNull()
    expect(parseContextTarget({ fieldId: 'f', kind: 'other' })).toBeNull()
  })

  it('knows a refusal to fill', () => {
    expect(fillRefused({ ok: false })).toBe(true)
    expect(fillRefused({ ok: true })).toBe(false)
    expect(fillRefused(undefined)).toBe(false)
  })
})
