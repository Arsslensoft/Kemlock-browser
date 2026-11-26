// @vitest-environment jsdom
// The keys screens over a fake background: the list and a key's page, the private half behind its warning, generating and
// importing, contacts, and the PGP tools.
import { h } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Send from '../send'
import keysEn from '../../../locales/parts/keys.en.json'
import type {
  ContactPreview,
  ContactView,
  KeyPreview,
  KeyView,
  PgpEncrypted,
  PgpVerified,
} from '../../shared/keys-api'
import { ToastProvider } from '../../shared/ui/components'
import {
  background,
  button,
  change,
  choose,
  click,
  input,
  installChrome,
  mount,
  selectOf,
  submit,
  switchOf,
  text,
  toggle,
  unmountAll,
  type FakeChrome,
} from '../testing'
import { KeysScreen, type KeysRoute } from './index'

vi.mock('../send', async (importActual) => {
  const actual = await importActual<typeof Send>()
  const { background } = await import('../testing')
  return {
    ...actual,
    ask: (...args: [string, Record<string, unknown>?]) => background.ask(...args),
  }
})

/** The extension's strings of this stream, with their `{name}` placeholders filled in order of first appearance. */
const say = (name: string, ...subs: string[]): string => {
  const raw = (keysEn as Record<string, string>)[name]
  if (raw === undefined) throw new Error(`no string ${name}`)
  const names: string[] = []
  return raw.replace(/\{(\w+)\}/g, (_, placeholder: string) => {
    if (!names.includes(placeholder)) names.push(placeholder)
    return subs[names.indexOf(placeholder)] ?? ''
  })
}

let fake: FakeChrome
let copied: string[]

beforeEach(() => {
  fake = installChrome()
  const base = chrome.i18n.getMessage.bind(chrome.i18n)
  Object.assign(chrome.i18n, {
    getMessage: (name: string, subs?: string | string[]) =>
      name in keysEn
        ? say(name, ...(subs === undefined ? [] : Array.isArray(subs) ? subs : [subs]))
        : base(name, subs),
  })
  copied = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => void copied.push(value) },
  })
  background.reset()
})

afterEach(() => {
  unmountAll()
})

const sshKey = (over: Partial<KeyView> = {}): KeyView => ({
  id: 'k1',
  name: 'laptop',
  kind: 'ssh',
  algorithm: 'Ed25519',
  origin: 'generated',
  fingerprint: 'SHA256:41s5abcdefghijklmnopqrstuvwxyz0123456789AW4',
  line: 'Ed25519',
  tags: ['work'],
  pinned: false,
  addedAt: Date.parse('2026-10-01T12:00:00Z'),
  protected: false,
  onCard: false,
  hasPublic: true,
  hasSshForm: true,
  inSpace: false,
  ...over,
})

const pgpKey = (over: Partial<KeyView> = {}): KeyView => ({
  ...sshKey(),
  id: 'k2',
  name: 'Sam <sam@example.org>',
  kind: 'pgp',
  algorithm: 'OpenPGP',
  fingerprint: '1FCD A135 0000 1111 2222 3333 4444 5555 6666 7777',
  line: 'sam@example.org · Ed25519',
  tags: [],
  hasSshForm: false,
  standing: 'ok',
  pgp: {
    userIds: ['Sam <sam@example.org>'],
    address: 'sam@example.org',
    version: 4,
    canSign: true,
    subkeys: [],
  },
  ...over,
})

const ada = (over: Partial<ContactView> = {}): ContactView => ({
  id: 'c1',
  name: 'Ada Lovelace',
  hasKey: true,
  fields: [],
  links: 0,
  fingerprint: 'AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111 2222 3333',
  line: 'ada@example.org · Ed25519',
  userIds: ['Ada Lovelace <ada@example.org>'],
  source: 'paste',
  checked: false,
  uncheckedAddresses: ['ada@example.org'],
  standing: 'ok',
  canEncrypt: true,
  addedAt: Date.parse('2026-10-02T12:00:00Z'),
  ...over,
})

/** A vault that answers like the background does, and changes as it is told to. */
function vault(initial: { keys?: KeyView[]; contacts?: ContactView[] } = {}) {
  const state = { keys: [...(initial.keys ?? [])], contacts: [...(initial.contacts ?? [])] }
  background.reset({
    keys: (() => state.keys) as never,
    contacts: (() => state.contacts) as never,
    keyPublic: (() => ({
      ssh: 'ssh-ed25519 AAAAC3Nza laptop',
      sshFile: 'laptop.pub',
      pem: '-----BEGIN PUBLIC KEY-----\nMCow\n-----END PUBLIC KEY-----\n',
      pemFile: 'laptop.pub.pem',
      pgp: false,
    })) as never,
    contactPublic: (() => ({
      pem: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nxsBN\n-----END PGP PUBLIC KEY BLOCK-----\n',
      fileName: 'Ada-Lovelace.pub.asc',
    })) as never,
    deleteKey: ((args: { id: string }) => {
      state.keys = state.keys.filter((item) => item.id !== args.id)
    }) as never,
  })
  return state
}

const open = (start?: KeysRoute) =>
  mount(h(ToastProvider, null, h(KeysScreen, { onBack: () => undefined, start })))

/** The part of a page under a title, as the page lays it out. */
const under = (root: HTMLElement, title: string): HTMLElement => {
  const found = [...root.querySelectorAll('section')].find(
    (section) => section.querySelector('h2')?.textContent === title,
  )
  if (found === undefined) throw new Error(`no section ${title}`)
  return found
}

/** The tool's own button, which a tab of the same name does not stand in for. */
const submitButton = (root: ParentNode): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>('button[type="submit"]')!

const values = (root: ParentNode) =>
  [...root.querySelectorAll('textarea')].map((area) => area.value)

describe('the list', () => {
  it('shows each key with what it is and its fingerprint, and each contact', async () => {
    vault({ keys: [sshKey(), pgpKey()], contacts: [ada()] })
    const root = await open()
    expect(text(root)).toContain('laptop')
    expect(text(root)).toContain('SSH key · Ed25519')
    expect(text(root)).toContain('SHA256:41s5…9AW4 · #work')
    expect(text(root)).toContain('sam@example.org · Ed25519')
    expect(text(root)).toContain('…4444 5555 6666 7777')

    await click(button(root, 'Contacts 1'))
    expect(text(root)).toContain('Ada Lovelace')
    expect(text(root)).toContain('Not compared')
    expect(text(root)).not.toContain('laptop')
  })

  it('shows a contact with no key by its email and company, with no fingerprint and no comparison', async () => {
    vault({
      contacts: [
        ada({
          hasKey: false,
          fingerprint: '',
          email: 'pat@example.org',
          company: 'Orbit',
          line: '',
        }),
      ],
    })
    const root = await open()
    await click(button(root, 'Contacts 1'))
    expect(text(root)).toContain('pat@example.org · Orbit')
    expect(text(root)).not.toContain('Not compared')
    expect(root.querySelector('.label.mono')).toBeNull()
  })

  it('searches, filters by tag, and says when nothing matches or nothing is there', async () => {
    vault({ keys: [sshKey(), pgpKey()] })
    const root = await open()
    await change(input(root, 'Search keys and contacts'), 'sam')
    expect(text(root)).toContain('Sam <sam@example.org>')
    expect(text(root)).not.toContain('laptop')
    await change(input(root, 'Search keys and contacts'), 'zzz')
    expect(text(root)).toContain(say('keys_noMatch'))
    await change(input(root, 'Search keys and contacts'), '')
    await click(button(root, 'work'))
    expect(text(root)).toContain('laptop')
    expect(text(root)).not.toContain('Sam <sam@example.org>')

    unmountAll()
    vault()
    const empty = await open()
    expect(text(empty)).toContain(say('keys_noKeys'))
    await click(button(empty, 'Contacts 0'))
    expect(text(empty)).toContain(say('keys_noContacts'))
  })

  it('marks a key that has expired or was revoked', async () => {
    vault({ keys: [pgpKey({ standing: 'expired' }), sshKey({ id: 'k3', name: 'old' })] })
    const root = await open()
    expect(text(root)).toContain('Expired')
  })
})

describe('a key', () => {
  it('shows what it is, and its public half in the forms it is handed out', async () => {
    vault({ keys: [sshKey()] })
    const root = await open()
    await click(button(root, 'Open laptop'))
    expect(text(root)).toContain('SSH key')
    expect(text(root)).toContain('Ed25519')
    expect(text(root)).toContain('SHA256:41s5abcdefghijklmnopqrstuvwxyz0123456789AW4')
    expect(values(root)).toContain('ssh-ed25519 AAAAC3Nza laptop')
    expect(values(root).some((value) => value.includes('BEGIN PUBLIC KEY'))).toBe(true)
    expect(text(root)).not.toContain('PRIVATE KEY')
    // Copying the public key is the page's own, with no private half involved
    await click(button(button(root, 'Copy')?.closest('.keys-block') ?? root, 'Copy'))
    expect(copied).toEqual(['ssh-ed25519 AAAAC3Nza laptop'])
    expect(background.of('exportKey')).toEqual([])
  })

  it('keeps the private half back until the warning is accepted, and hides it again', async () => {
    vault({ keys: [sshKey()] })
    background.set({
      exportKey: (() => ({
        text: '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET\n-----END OPENSSH PRIVATE KEY-----\n',
        fileName: 'laptop',
        ownPassphrase: false,
        partlyProtected: false,
      })) as never,
    })
    const root = await open()
    await click(button(root, 'Open laptop'))
    await click(button(under(root, 'Private key'), 'Show'))
    expect(text(root)).toContain(say('keys_privateWarnTitle'))
    expect(background.of('exportKey')).toEqual([])
    // Cancel takes the warning away and asks for nothing
    await click(button(root, 'Cancel'))
    expect(background.of('exportKey')).toEqual([])
    expect(text(root)).not.toContain(say('keys_privateWarnTitle'))

    await click(button(under(root, 'Private key'), 'Show'))
    await click(button(root, 'Continue'))
    expect(background.of('exportKey').map((call) => call.args)).toEqual([
      { id: 'k1', purpose: 'show' },
    ])
    expect(values(root).some((value) => value.includes('SECRET'))).toBe(true)
    await click(button(root, 'Hide'))
    expect(values(root).some((value) => value.includes('SECRET'))).toBe(false)
  })

  it('has the background copy the private half, so it never reaches the page', async () => {
    vault({ keys: [sshKey()] })
    background.set({ copyKey: (() => undefined) as never })
    const root = await open()
    await click(button(root, 'Open laptop'))
    await click(button(under(root, 'Private key'), 'Copy'))
    await click(button(root, 'Continue'))
    expect(background.of('copyKey').map((call) => call.args)).toEqual([{ id: 'k1' }])
    expect(background.of('exportKey')).toEqual([])
    expect(text(root)).toContain(say('keys_privateCopied'))
    expect(copied).toEqual([])
  })

  it('saves the private half as a file under a passphrase typed twice', async () => {
    vault({ keys: [sshKey()] })
    background.set({
      exportKey: (() => ({
        text: 'PRIVATE',
        fileName: 'laptop',
        ownPassphrase: false,
        partlyProtected: false,
      })) as never,
    })
    URL.createObjectURL = () => 'blob:kemlock'
    URL.revokeObjectURL = () => undefined
    HTMLAnchorElement.prototype.click = () => undefined
    const root = await open()
    await click(button(root, 'Open laptop'))
    await click(button(under(root, 'Private key'), 'Save as a file…'))
    await click(button(root, 'Continue'))
    expect(button(root, 'Save the file')?.disabled).toBe(true)
    await change(input(root, 'Passphrase'), 'blue heron lantern')
    await change(input(root, 'The passphrase again'), 'blue heron')
    expect(text(root)).toContain(say('keys_exportMismatch'))
    expect(button(root, 'Save the file')?.disabled).toBe(true)
    await change(input(root, 'The passphrase again'), 'blue heron lantern')
    await submit(root.querySelector('form'))
    expect(background.of('exportKey').map((call) => call.args)).toEqual([
      { id: 'k1', purpose: 'file', passphrase: 'blue heron lantern' },
    ])
    expect(text(root)).toContain(say('keys_saved', 'laptop'))
  })

  it('does not offer a file for a key of a space, nor a private half for one on a card', async () => {
    vault({ keys: [sshKey({ inSpace: true }), pgpKey({ onCard: true })] })
    const root = await open()
    await click(button(root, 'Open laptop'))
    expect(button(under(root, 'Private key'), 'Save as a file…')?.disabled).toBe(true)
    await click(button(root, 'Back'))
    await click(button(root, 'Open Sam <sam@example.org>'))
    expect(text(root)).toContain(say('keys_onCard'))
    expect(button(root, 'Show')).toBeNull()
  })

  it('renames, and deletes after asking', async () => {
    const state = vault({ keys: [sshKey()] })
    background.set({
      saveKey: ((args: { id: string; name: string }) => {
        state.keys = state.keys.map((item) =>
          item.id === args.id ? { ...item, name: args.name } : item,
        )
        return state.keys[0]
      }) as never,
    })
    const root = await open()
    await click(button(root, 'Open laptop'))
    expect(button(root, 'Save')?.disabled).toBe(true)
    await change(input(root, 'Name'), 'work laptop')
    await submit(under(root, 'Details').querySelector('form'))
    expect(background.of('saveKey')[0]?.args).toEqual({
      id: 'k1',
      name: 'work laptop',
      note: '',
      tags: ['work'],
    })

    await click(button(root, 'Delete this key'))
    expect(background.of('deleteKey')).toEqual([])
    await click(button(root, 'Delete'))
    expect(background.of('deleteKey')[0]?.args).toEqual({ id: 'k1' })
    expect(text(root)).toContain(say('keys_noKeys'))
  })
})

describe('adding a key', () => {
  it('makes a PGP key from a name and an email, with the app’s defaults', async () => {
    const state = vault()
    background.set({
      generateKey: (() => {
        const made = pgpKey({ id: 'k9', name: 'Ada <ada@example.org>' })
        state.keys.push(made)
        return made
      }) as never,
    })
    const root = await open({ name: 'addKey' })
    await choose(selectOf(root, 'Kind of key'), 'pgp')
    await submit(root.querySelector('form'))
    expect(background.of('generateKey')).toEqual([])
    expect(text(root)).toContain(say('keys_pgpNameMissing'))
    await change(input(root, 'Your name'), 'Ada')
    await change(input(root, 'Email address'), 'ada@example.org')
    await submit(root.querySelector('form'))
    expect(background.of('generateKey')[0]?.args).toEqual({
      input: {
        kind: 'pgp',
        type: 'pqStandard',
        name: 'Ada',
        email: 'ada@example.org',
        expiresInYears: 2,
      },
    })
    // The new key's page is shown
    expect(text(root)).toContain('Ada <ada@example.org>')
    expect(text(root)).toContain('Private key')
  })

  it('makes an SSH key of the algorithm chosen, and says an RSA one is slow', async () => {
    vault()
    background.set({ generateKey: (() => sshKey({ id: 'k8' })) as never })
    const root = await open({ name: 'addKey' })
    expect(text(root)).not.toContain(say('keys_generateSlow'))
    await choose(selectOf(root, 'Algorithm'), 'rsa:4096')
    expect(text(root)).toContain(say('keys_generateSlow'))
    await change(input(root, 'Name'), 'server')
    await submit(root.querySelector('form'))
    expect(background.of('generateKey')[0]?.args).toEqual({
      input: { kind: 'ssh', algorithm: 'rsa', bits: 4096, name: 'server' },
    })
  })

  it('imports a key, asking its passphrase when it is protected', async () => {
    const state = vault()
    let attempt = 0
    const preview: KeyPreview = {
      kind: 'ssh',
      algorithm: 'Ed25519',
      fingerprint: 'SHA256:abc',
      defaultName: 'work-key',
      canBeSsh: false,
      userIds: [],
      protected: false,
      held: null,
    }
    background.set({
      previewKey: ((args: { passphrase?: string }) => {
        attempt += 1
        if (args.passphrase === undefined) throw new Error('keyPassphraseNeeded')
        if (args.passphrase !== 'open sesame') throw new Error('keyWrongPassphrase')
        return preview
      }) as never,
      importKey: (() => {
        const added = sshKey({ id: 'k7', name: 'work-key', origin: 'imported' })
        state.keys.push(added)
        return added
      }) as never,
    })
    const root = await open({ name: 'addKey' })
    await click(button(root, 'Import'))
    await change(input(root, 'Private key'), '-----BEGIN OPENSSH PRIVATE KEY-----\nxx')
    await submit(root.querySelector('form'))
    expect(attempt).toBe(1)
    expect(input(root, 'Passphrase')).not.toBeNull()
    await change(input(root, 'Passphrase'), 'wrong')
    await click(button(root, 'Open the key'))
    expect(text(root)).toContain(say('keys_error_keyWrongPassphrase'))
    await change(input(root, 'Passphrase'), 'open sesame')
    await click(button(root, 'Open the key'))
    expect(text(root)).toContain('SSH key · Ed25519')
    expect((input(root, 'Name') as HTMLInputElement).value).toBe('work-key')
    await submit(root.querySelector('form'))
    expect(background.of('importKey')[0]?.args).toEqual({
      text: '-----BEGIN OPENSSH PRIVATE KEY-----\nxx',
      passphrase: 'open sesame',
      name: 'work-key',
    })
    expect(text(root)).toContain('work-key')
  })

  it('says a key is held already, and updates it when the copy adds to it', async () => {
    vault()
    background.set({
      previewKey: (() => ({
        kind: 'pgp',
        algorithm: 'OpenPGP',
        fingerprint: '1FCD A135',
        defaultName: 'Sam',
        canBeSsh: false,
        userIds: ['Sam <sam@example.org>'],
        protected: false,
        held: { id: 'k2', name: 'Sam <sam@example.org>', update: true },
      })) as never,
      importKey: (() => pgpKey()) as never,
    })
    const root = await open({ name: 'addKey', text: '-----BEGIN PGP PRIVATE KEY BLOCK-----' })
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(say('keys_importHeld', 'Sam <sam@example.org>'))
    await click(button(root, 'Update the key'))
    expect(background.of('importKey')[0]?.args).toMatchObject({ update: true })
  })

  it('offers a public key as a contact, and the popup sends file choosing to the keys tab', async () => {
    vault()
    background.set({
      previewKey: (() => {
        throw new Error('keyPublicKeyOnly')
      }) as never,
    })
    const root = await open({ name: 'addKey', text: '-----BEGIN PGP PUBLIC KEY BLOCK-----' })
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(say('keys_error_keyPublicKeyOnly'))
    await click(button(root, 'Choose a file in a tab'))
    expect(fake.tabsCreated).toEqual(['chrome-extension://kemlock/src/keys/index.html#addKey'])
    await click(button(root, 'Add it as a contact'))
    expect(text(root)).toContain('Add a contact')
  })
})

describe('contacts', () => {
  const preview: ContactPreview = {
    fingerprintHex: 'AAAABBBBCCCCDDDDEEEEFFFF000011112222333',
    fingerprint: 'AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111 2222 333',
    name: 'Ada Lovelace',
    line: 'ada@example.org · Ed25519',
    userIds: ['Ada Lovelace <ada@example.org>'],
    standing: 'ok',
    status: 'new',
  }

  it('are read first, with the fingerprint, and added with the comparison the person made', async () => {
    const state = vault()
    background.set({
      previewContacts: (() => [preview]) as never,
      addContacts: (() => {
        state.contacts.push(ada({ checked: true }))
        return [ada({ checked: true })]
      }) as never,
    })
    const root = await open({ name: 'addContact' })
    expect(button(root, 'Read the key')?.disabled).toBe(true)
    await change(input(root, 'Public key'), '-----BEGIN PGP PUBLIC KEY BLOCK-----\nxx')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain('AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111 2222 333')
    expect(background.of('addContacts')).toEqual([])
    await toggle(switchOf(root, say('keys_compared')), true)
    await submit(root.querySelector('form'))
    expect(background.of('addContacts')[0]?.args).toEqual({
      text: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nxx',
      source: 'paste',
      checked: ['AAAABBBBCCCCDDDDEEEEFFFF000011112222333'],
    })
    // The contact's page is shown
    expect(text(root)).toContain(say('keys_checkedLine'))
  })

  it('say a key is the vault’s own or a contact’s already, and offer to replace one with the same address', async () => {
    vault({ contacts: [ada()] })
    background.set({
      previewContacts: (() => [
        { ...preview, status: 'own', existingName: 'Me' },
        { ...preview, fingerprintHex: 'BB', status: 'held', existingName: 'Ada Lovelace' },
        {
          ...preview,
          fingerprintHex: 'CC',
          sameAddressId: 'c1',
          sameAddressName: 'Ada Lovelace',
          sameAddress: 'ada@example.org',
        },
      ]) as never,
    })
    const root = await open({ name: 'addContact', text: 'x' })
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(say('keys_contactOwn', 'Me'))
    expect(text(root)).toContain(say('keys_contactHeld', 'Ada Lovelace'))
    expect(switchOf(root, say('keys_contactReplace', 'Ada Lovelace'))).not.toBeNull()
  })

  it('show how they were told apart, and mark the fingerprint compared after asking', async () => {
    const state = vault({ contacts: [ada()] })
    background.set({
      saveContact: ((args: { checked?: boolean }) => {
        state.contacts = [ada({ checked: args.checked === true })]
        return state.contacts[0]
      }) as never,
    })
    const root = await open({ name: 'list', tab: 'contacts' })
    await click(button(root, 'Open Ada Lovelace'))
    expect(text(root)).toContain(say('keys_notCheckedLine'))
    expect(values(root).some((value) => value.includes('BEGIN PGP PUBLIC KEY BLOCK'))).toBe(true)
    await click(button(root, 'I compared it'))
    expect(background.of('saveContact')).toEqual([])
    expect(text(root)).toContain(
      say('keys_compareBody', 'AAAA BBBB CCCC DDDD EEEE FFFF 0000 1111 2222 3333'),
    )
    await click(button(root, 'Yes, it matches'))
    expect(background.of('saveContact')[0]?.args).toEqual({ id: 'c1', checked: true })
    expect(text(root)).toContain(say('keys_checkedLine'))
  })

  it('are deleted after asking', async () => {
    const state = vault({ contacts: [ada()] })
    background.set({
      deleteContact: (() => {
        state.contacts = []
      }) as never,
    })
    const root = await open({ name: 'list', tab: 'contacts' })
    await click(button(root, 'Open Ada Lovelace'))
    await click(button(root, 'Delete this contact'))
    expect(background.of('deleteContact')).toEqual([])
    await click(button(root, 'Delete'))
    expect(background.of('deleteContact')[0]?.args).toEqual({ id: 'c1' })
    expect(text(root)).toContain(say('keys_noContacts'))
  })
})

describe('the PGP tools', () => {
  it('encrypt to the contacts chosen, warning about one never compared', async () => {
    vault({ contacts: [ada(), ada({ id: 'c2', name: 'Bo', canEncrypt: false })] })
    background.set({
      pgpEncrypt: (() =>
        ({
          text: '-----BEGIN PGP MESSAGE-----\nabc\n-----END PGP MESSAGE-----',
        }) satisfies PgpEncrypted) as never,
    })
    const root = await open({ name: 'tools', tool: 'encrypt' })
    // A contact that can't be encrypted to is not offered
    expect(switchOf(root, 'Bo')).toBeNull()
    expect(submitButton(root).disabled).toBe(true)
    await toggle(switchOf(root, 'Ada Lovelace'), true)
    expect(text(root)).toContain(say('keys_encryptUnchecked', 'Ada Lovelace'))
    await change(input(root, 'Message'), 'hello')
    await submit(root.querySelector('form'))
    expect(background.of('pgpEncrypt')[0]?.args).toEqual({
      data: { text: 'hello' },
      contactIds: ['c1'],
      keyIds: [],
    })
    expect(values(root).some((value) => value.includes('BEGIN PGP MESSAGE'))).toBe(true)
  })

  it('encrypt with a passphrase typed twice', async () => {
    vault()
    background.set({ pgpEncrypt: (() => ({ text: 'armored' })) as never })
    const root = await open({ name: 'tools', tool: 'encrypt' })
    await click(button(root, 'With a passphrase'))
    await change(input(root, 'Message'), 'secret')
    await change(input(root, 'Passphrase'), 'blue heron')
    await change(input(root, 'The passphrase again'), 'blue')
    expect(submitButton(root).disabled).toBe(true)
    await change(input(root, 'The passphrase again'), 'blue heron')
    await submit(root.querySelector('form'))
    expect(background.of('pgpEncrypt')[0]?.args).toEqual({
      data: { text: 'secret' },
      contactIds: [],
      keyIds: [],
      passphrase: 'blue heron',
    })
  })

  it('decrypt, asking a passphrase only when one is needed', async () => {
    vault({ keys: [pgpKey()] })
    background.set({
      pgpDecrypt: ((args: { passphrase?: string }) => {
        if (args.passphrase === undefined) throw new Error('pgpPassphraseNeeded')
        return {
          isText: true,
          encrypted: true,
          length: 5,
          fileName: '',
          text: 'hello',
          openedWithPassphrase: false,
          openedWith: { kind: 'key', id: 'k2', name: 'Sam', checked: true },
          signatures: [
            {
              verdict: 'good',
              signer: { kind: 'contact', id: 'c1', name: 'Ada', checked: true },
              keyExpired: false,
              keyExpiredSince: false,
              keyRevoked: false,
            },
          ],
        }
      }) as never,
    })
    const root = await open({ name: 'tools', tool: 'decrypt' })
    await change(input(root, 'Encrypted message'), '-----BEGIN PGP MESSAGE-----\nabc')
    await submit(root.querySelector('form'))
    // Asked for it, and said nothing wrong yet
    expect(input(root, 'Passphrase')).not.toBeNull()
    expect(root.querySelector('.notice.error')).toBeNull()
    await change(input(root, 'Passphrase'), 'blue heron')
    await submit(root.querySelector('form'))
    expect(values(root)).toContain('hello')
    expect(text(root)).toContain(say('keys_openedWith', 'Sam'))
    expect(text(root)).toContain(say('keys_verdictGood', 'Ada'))
  })

  it('say why a message does not open, in words', async () => {
    vault({ keys: [pgpKey()] })
    background.set({
      pgpDecrypt: (() => {
        throw new Error('pgpNoKeyOpensIt')
      }) as never,
    })
    const root = await open({ name: 'tools', tool: 'decrypt' })
    await change(input(root, 'Encrypted message'), 'x')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(say('keys_error_pgpNoKeyOpensIt'))
  })

  it('sign with the key chosen, and name the form of the signature', async () => {
    vault({ keys: [sshKey(), pgpKey()] })
    background.set({
      pgpSign: (() => ({ text: '-----BEGIN PGP SIGNED MESSAGE-----' })) as never,
      sshSign: (() => ({ text: '-----BEGIN SSH SIGNATURE-----' })) as never,
    })
    const root = await open({ name: 'tools', tool: 'sign', keyId: 'k2' })
    await change(input(root, 'Text to sign'), 'I agree')
    await submit(root.querySelector('form'))
    expect(background.of('pgpSign')[0]?.args).toEqual({
      text: 'I agree',
      keyId: 'k2',
      form: 'cleartext',
    })
    await choose(selectOf(root, 'Sign with'), 'k1')
    await submit(root.querySelector('form'))
    expect(background.of('sshSign')[0]?.args).toEqual({
      text: 'I agree',
      keyId: 'k1',
      namespace: 'file',
    })
    expect(values(root).some((value) => value.includes('SSH SIGNATURE'))).toBe(true)
  })

  it('ask the passphrase of a key protected in part only when signing says so, and try again', async () => {
    vault({ keys: [pgpKey()] })
    const label = say('keys_keyPassphrase', 'Sam <sam@example.org>')
    background.set({
      pgpSign: ((args: { passphrase?: string }) => {
        if (args.passphrase === undefined) throw new Error('pgpPassphraseNeeded')
        if (args.passphrase !== 'right one') throw new Error('pgpWrongPassphrase')
        return { text: '-----BEGIN PGP SIGNED MESSAGE-----' }
      }) as never,
    })
    const root = await open({ name: 'tools', tool: 'sign', keyId: 'k2' })
    expect(input(root, label)).toBeNull()
    await change(input(root, 'Text to sign'), 'I agree')
    await submit(root.querySelector('form'))
    // The key said it needs one: the field shows, with no error yet
    expect(input(root, label)).not.toBeNull()
    expect(root.querySelector('.notice.error')).toBeNull()
    expect(submitButton(root).disabled).toBe(true)
    await change(input(root, label), 'wrong one')
    await submit(root.querySelector('form'))
    expect(text(root)).toContain(say('keys_error_pgpWrongPassphrase'))
    await change(input(root, label), 'right one')
    await submit(root.querySelector('form'))
    expect(background.of('pgpSign').at(-1)?.args).toEqual({
      text: 'I agree',
      keyId: 'k2',
      form: 'cleartext',
      passphrase: 'right one',
    })
    expect(values(root).some((value) => value.includes('SIGNED MESSAGE'))).toBe(true)
  })

  it('do the same when encrypting signed with such a key', async () => {
    vault({ keys: [pgpKey()], contacts: [ada()] })
    const label = say('keys_keyPassphrase', 'Sam <sam@example.org>')
    background.set({
      pgpEncrypt: ((args: { signPassphrase?: string }) => {
        if (args.signPassphrase === undefined) throw new Error('pgpPassphraseNeeded')
        return { text: 'armored' }
      }) as never,
    })
    const root = await open({ name: 'tools', tool: 'encrypt' })
    await toggle(switchOf(root, 'Ada Lovelace'), true)
    await change(input(root, 'Message'), 'hello')
    await choose(selectOf(root, say('keys_encryptSignAs')), 'k2')
    await submit(root.querySelector('form'))
    expect(input(root, label)).not.toBeNull()
    await change(input(root, label), 'right one')
    await submit(root.querySelector('form'))
    expect(background.of('pgpEncrypt').at(-1)?.args).toMatchObject({
      signWith: 'k2',
      signPassphrase: 'right one',
    })
    expect(values(root)).toContain('armored')
  })

  it('verify a PGP signature and say who signed, and an SSH one and its namespace', async () => {
    vault()
    const verified: PgpVerified = {
      isText: true,
      text: 'I agree',
      signatures: [
        {
          verdict: 'good',
          signer: { kind: 'contact', id: 'c1', name: 'Ada', checked: false },
          keyExpired: false,
          keyExpiredSince: false,
          keyRevoked: false,
        },
      ],
    }
    background.set({
      pgpVerify: (() => verified) as never,
      sshVerify: (() => ({
        verdict: 'wrongNamespace',
        detail: 'file',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
        namespace: 'file',
        matches: null,
        own: null,
      })) as never,
    })
    const root = await open({ name: 'tools', tool: 'verify' })
    await change(input(root, 'Signed text or file'), 'x')
    await submit(root.querySelector('form'))
    expect(background.of('pgpVerify')[0]?.args).toEqual({ text: 'x' })
    expect(text(root)).toContain(say('keys_verdictGood', 'Ada'))
    expect(text(root)).toContain(say('keys_signerUnchecked'))
    expect(values(root)).toContain('I agree')

    await choose(selectOf(root, 'What to check'), 'ssh')
    await change(input(root, 'Signature'), '-----BEGIN SSH SIGNATURE-----')
    await choose(selectOf(root, 'The signature is for'), 'git')
    await submit(root.querySelector('form'))
    expect(background.of('sshVerify')[0]?.args).toEqual({
      text: 'x',
      signature: '-----BEGIN SSH SIGNATURE-----',
      namespace: 'git',
    })
    expect(text(root)).toContain(say('keys_sshNamespace', 'file', 'git'))
  })

  it('check the signature of a pasted git commit', async () => {
    vault()
    background.set({
      sshVerify: (() => ({
        verdict: 'good',
        keyType: 'ssh-ed25519',
        fingerprint: 'SHA256:abc',
        namespace: 'git',
        matches: null,
        own: { id: 'k1', name: 'laptop' },
      })) as never,
    })
    const root = await open({ name: 'tools', tool: 'verify' })
    await choose(selectOf(root, 'What to check'), 'git')
    await change(input(root, 'The commit or tag, as git cat-file prints it'), 'tree 4b825dc')
    await submit(root.querySelector('form'))
    expect(background.of('sshVerify')[0]?.args).toEqual({ text: 'tree 4b825dc', git: true })
    expect(text(root)).toContain(say('keys_sshGoodOwn', 'laptop'))
  })

  it('send file choosing to the keys tab from the popup', async () => {
    vault()
    const root = await open({ name: 'tools', tool: 'decrypt' })
    await click(button(root, 'Choose a file in a tab'))
    expect(fake.tabsCreated).toEqual([
      'chrome-extension://kemlock/src/keys/index.html#tools/decrypt',
    ])
  })
})
