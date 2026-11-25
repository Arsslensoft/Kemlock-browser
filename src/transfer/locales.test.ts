import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cxfKinds, transferKinds } from '../shared/transfer'

const here = import.meta.dirname
const root = join(here, '..', '..')
const read = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>
const en = read('locales/parts/transfer.en.json')
const fr = read('locales/parts/transfer.fr.json')

const sources = [
  ...readdirSync(here)
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
    .map((file) => readFileSync(join(here, file), 'utf8')),
  readFileSync(join(root, 'src', 'popup', 'transfer-card.tsx'), 'utf8'),
].join('\n')

// Names built in code
const formats = [
  'kemlock',
  'google',
  'aegis',
  'twoFas',
  'bitwarden',
  'uris',
  'cxf',
  'csv',
  'qr',
  'kemlockQr',
]
const samples = ['code', 'login', 'backupServices', 'note', 'passkey', 'key', 'card', 'identity']
const skips = [
  'file',
  'wifi',
  'apiKey',
  'generatedPassword',
  'itemReference',
  'unknownType',
  'unreadable',
  'totpAlgorithm',
  'totpDigits',
  'totpSecret',
  'passkeyAlgorithm',
  'passkeyKey',
  'sshKey',
  'nothingKept',
]
const choices = [
  'encrypted',
  'plain',
  'csv',
  'links',
  'cxf',
  'qrGoogle',
  'qrKemlock',
  'qrKemlockPlain',
]
const plain = ['plain', 'csv', 'links', 'cxf', 'qrGoogle', 'qrKemlockPlain']
// What the core's CxfLeftOutReason and the Google writer's MigrationLeftOutReason name
const cxfReasons = ['notSshKey', 'protectedKey', 'notTotp', 'onCard', 'algorithm']
const migrationReasons = ['steam', 'period', 'digits', 'algorithm', 'secret', 'tooLong']
// The words the background and the core answer with (src/background/errors.ts, core/lib/src/failure.dart, transfer_service.dart)
const errors = [
  'failed',
  'locked',
  'refused',
  'noVault',
  'unreadable',
  'fileTooLarge',
  'imagesTooLarge',
  'oneFile',
  'importUnsupported',
  'importEmpty',
  'importBadPassword',
  'importBitwardenEncrypted',
  'importCxfTooLarge',
  'importCxfVersion',
  'importCxfMalformed',
  'importArchive',
  'importQrMissing',
  'importCorrupt',
  'importTooLarge',
  'importNothing',
  'importNoKit',
  'importKitFormat',
  'importKitChecksum',
  'importKitOtherKit',
  'importKitDuplicate',
  'importKitNotEnough',
  'importKitWrong',
  'notFound',
  'badPassword',
  'exportTooShort',
  'exportCheckFailed',
]
const counted = [
  'transfer_source_images',
  'transfer_unread_images',
  'transfer_units_count',
  'transfer_import_button',
  'transfer_skipped',
  'transfer_skips_title',
  'transfer_skips_more',
  'transfer_attached',
  'transfer_review_spaces',
  'transfer_archive',
  'transfer_done_skipped',
  'transfer_export_spaces',
  'transfer_export_attached',
  'transfer_qr_shown',
  ...['items', 'credentials', 'urls', 'collections', 'values'].map((n) => `transfer_cut_${n}`),
  ...cxfReasons.map((reason) => `transfer_export_cxfLeft_${reason}`),
]
const dynamic = [
  ...transferKinds.map((kind) => `transfer_kind_${kind}`),
  ...cxfKinds.map((kind) => `transfer_kind_${kind}`),
  ...formats.map((format) => `transfer_format_${format}`),
  ...samples.map((kind) => `transfer_sample_${kind}`),
  ...skips.map((reason) => `transfer_skip_${reason}`),
  ...choices.flatMap((choice) => [
    `transfer_export_${choice}_title`,
    `transfer_export_${choice}_body`,
  ]),
  ...plain.map((choice) => `transfer_export_${choice}_warning`),
  ...cxfReasons.map((reason) => `transfer_export_left_${reason}`),
  'transfer_export_left_secret',
  ...migrationReasons.map((reason) => `transfer_qr_left_${reason}`),
  ...errors.map((word) => `transfer_error_${word}`),
  ...['merge', 'replace'].map((mode) => `transfer_mode_${mode}`),
  ...counted.flatMap((name) => [`${name}_one`, `${name}_other`]),
]

describe('the transfer strings', () => {
  it('are the same names in English and French', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it('have a browser-legal name, unique without regard to case', () => {
    const names = Object.keys(en)
    for (const name of names) expect(name).toMatch(/^transfer_[A-Za-z0-9_]+$/)
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
  })

  it('keep the same placeholders in the same order in both languages', () => {
    const names = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))]
    for (const [name, text] of Object.entries(en))
      expect(names(fr[name]!), name).toEqual(names(text))
  })

  it('include every name the code asks for', () => {
    const asked = [...sources.matchAll(/'(transfer_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)'/g)].map(
      (m) => m[1]!,
    )
    for (const name of new Set(asked)) {
      expect(
        name in en ||
          counted.includes(name) ||
          /^transfer_(error|kind|format|sample|skip)_?$/.test(name),
        name,
      ).toBe(true)
    }
    for (const name of dynamic) expect(name in en, name).toBe(true)
  })

  it('write French that is not English again', () => {
    const same = Object.entries(en)
      .filter(([name, text]) => fr[name] === text)
      .map(([name]) => name)
      .sort()
    // Names and words that read the same in both languages
    expect(same).toEqual([
      'transfer_export_cxf_title',
      'transfer_kind_codes',
      'transfer_kind_notes',
      'transfer_sample_code',
      'transfer_sample_note',
    ])
  })
})
