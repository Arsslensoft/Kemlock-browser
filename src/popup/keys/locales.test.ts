import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import appEn from '../../../locales/app/en.json'
import baseEn from '../../../locales/en.json'
import keysEn from '../../../locales/parts/keys.en.json'
import keysFr from '../../../locales/parts/keys.fr.json'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const fr = keysFr as Record<string, string>

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })
}

// The keys screens, the keys tab, and the one string Home asks for
const used = new Set(
  [...sources(join(root, 'src', 'popup', 'keys')), join(root, 'src', 'popup', 'home.tsx')].flatMap(
    (file) =>
      [...readFileSync(file, 'utf8').matchAll(/['"`](keys_[A-Za-z0-9_]+)['"`]/g)].map((m) => m[1]!),
  ),
)
for (const file of sources(join(root, 'src', 'keys')))
  for (const m of readFileSync(file, 'utf8').matchAll(/['"`](keys_[A-Za-z0-9_]+)['"`]/g))
    used.add(m[1]!)

// Names the code builds: the kinds' help, the PGP types, a subkey's uses
const dynamic = [
  ...['ssh', 'signing', 'exchange', 'pgp'].map((kind) => `keys_generate_${kind}`),
  ...['pqStandard', 'pqGnupg', 'ed25519', 'rsa4096'].flatMap((type) => [
    `keys_pgp_${type}`,
    `keys_pgp_${type}_caption`,
  ]),
  ...['certify', 'sign', 'encrypt', 'authenticate'].map((use) => `keys_use_${use}`),
]

/** The words the core fails with: the key and message code's, the services' own, and the shared ones. */
const word = (prefix: string, problem: string) =>
  `${prefix}${problem[0]!.toUpperCase()}${problem.slice(1)}`
const keyProblems = [
  'publicKeyOnly',
  'puttyKey',
  'legacyPemEncryption',
  'unsupportedCipher',
  'unsupportedKeyType',
  'tooLarge',
  'damaged',
  'unrecognized',
  'passphraseNeeded',
  'wrongPassphrase',
  'privateKeyGiven',
]
const pgpProblems = [
  'notAMessage',
  'noKeyOpensIt',
  'passphraseNeeded',
  'wrongPassphrase',
  'damaged',
  'noIntegrity',
  'unsupported',
  'keyUnusable',
  'noSecretHere',
  'tooLarge',
  'outOfSpace',
  'cancelled',
]
const dartWords = (): string[] => {
  const files = ['keys_args', 'keys_service', 'pgp_service'].map((name) =>
    readFileSync(join(root, 'core', 'lib', 'src', `${name}.dart`), 'utf8'),
  )
  return files.flatMap((text) => [...text.matchAll(/CoreFailure\('(\w+)'/g)].map((m) => m[1]!))
}
const coreWords = [
  ...keyProblems.map((problem) => word('key', problem)),
  // What reading a public key can fail with
  ...['privateKeyGiven', 'unrecognized', 'damaged', 'unsupportedKeyType', 'tooLarge'].map(
    (problem) => word('contact', problem),
  ),
  'contactFailsChecks',
  ...pgpProblems.map((problem) => word('pgp', problem)),
  'pgpIsEncrypted',
  'pgpIsSignature',
  'pgpNotSigned',
  'pgpKeyExpired',
  'pgpKeyRevoked',
  'pgpKeyInvalid',
  'pgpKeyWeak',
  'pgpKeyNoSuchKey',
  'pgpTextTooLarge',
  'sshNotSsh',
  'sshDamaged',
  'sshGitUnsigned',
  'sshGitPgp',
  'sshNotGit',
  'sshBadSigner',
  'keyOnCard',
  'keyInSpace',
  'duplicate',
  'invalid',
  'notFound',
  'tooLarge',
]

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('the keys screens’ strings', () => {
  it('has every string the screens ask for, in English and in French', () => {
    const missing = [...used, ...dynamic].filter((name) => !(name in keysEn) || !(name in fr))
    expect(missing).toEqual([])
  })

  it('has no string nothing asks for', () => {
    const wanted = new Set([...used, ...dynamic, ...coreWords.map((w) => `keys_error_${w}`)])
    expect(Object.keys(keysEn).filter((name) => !wanted.has(name))).toEqual([])
  })

  it('says every failure of the core in words, in both languages', () => {
    const missing = [...new Set([...coreWords, ...dartWords()])].filter(
      (failure) => !(`keys_error_${failure}` in keysEn) || !(`keys_error_${failure}` in fr),
    )
    expect(missing).toEqual([])
  })

  it('has the same strings in both languages, with the same placeholders', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(keysEn).sort())
    for (const [name, text] of Object.entries(keysEn))
      expect(placeholders(fr[name]!), name).toEqual(placeholders(text))
  })

  it('has no name the build would see twice, case aside', () => {
    const others = [...Object.keys(baseEn), ...Object.keys(appEn)].map((name) => name.toLowerCase())
    const names = Object.keys(keysEn).map((name) => name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => others.includes(name))).toEqual([])
  })

  it('writes French that is French, not English again', () => {
    const same = Object.entries(keysEn)
      .filter(([name, text]) => fr[name] === text)
      .map(([name]) => name)
      .sort()
    // Names and words that read the same in both languages
    expect(same).toEqual([
      'keys_contacts',
      'keys_decryptResult',
      'keys_encryptMessage',
      'keys_fieldNote',
      'keys_fileChosen',
      'keys_pgp_ed25519',
      'keys_pgp_rsa4096',
      'keys_signResult',
      'keys_verifySignature',
    ])
  })
})
