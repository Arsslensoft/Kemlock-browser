import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import appEn from '../../locales/app/en.json'
import baseEn from '../../locales/en.json'
import accountEn from '../../locales/parts/account.en.json'
import accountFr from '../../locales/parts/account.fr.json'

const here = import.meta.dirname
const src = join(here, '..')

const sourcesOf = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourcesOf(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : []
  })

// Every place that asks for an account string
const files = [
  ...sourcesOf(here),
  join(src, 'setup', 'accountScreens.tsx'),
  join(src, 'setup', 'stepScreens.tsx'),
  join(src, 'popup', 'account-actions.tsx'),
  join(src, 'background', 'account.ts'),
]
const text = files.map((file) => readFileSync(file, 'utf8')).join('\n')
const asked = new Set([...text.matchAll(/account_[A-Za-z0-9_]+/g)].map((m) => m[0]))

// A name that ends in an underscore is the start of one made in code (`account_error_${code}`)
const families = [...asked].filter((name) => name.endsWith('_'))
const names = [...asked].filter((name) => !name.endsWith('_'))

const placeholders = (value: string): string[] => [
  ...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)),
]

const en = accountEn as Record<string, string>
const fr = accountFr as Record<string, string>

describe('the account strings', () => {
  it('are the same names in English and French, with the same placeholders', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
    for (const [name, value] of Object.entries(en))
      expect(placeholders(fr[name]!), name).toEqual(placeholders(value))
  })

  it('have a browser-legal name, unique without regard to case, and none the build would see twice', () => {
    const own = Object.keys(en)
    for (const name of own) expect(name).toMatch(/^(account|setup|sync_problem)_[A-Za-z0-9_]+$/)
    expect(new Set(own.map((name) => name.toLowerCase())).size).toBe(own.length)
    const others = [...Object.keys(baseEn), ...Object.keys(appEn)].map((name) => name.toLowerCase())
    expect(own.filter((name) => others.includes(name.toLowerCase()))).toEqual([])
  })

  it('include every name the code asks for, and the families it builds', () => {
    expect(names.filter((name) => !(name in en))).toEqual([])
    for (const family of families)
      expect(
        Object.keys(en).some((name) => name.startsWith(family)),
        family,
      ).toBe(true)
  })

  it('include no name the code never asks for', () => {
    const wanted = (name: string) =>
      asked.has(name) ||
      families.some((family) => name.startsWith(family)) ||
      // Asked for by the setup tab's second step, as `setup_method_${method}`
      name.startsWith('setup_method_recoveryCode') ||
      // Asked for by the popup, as `sync_problem_${problem}`, for the one problem the account adds
      name === 'sync_problem_moveUnfinished'
    expect(Object.keys(en).filter((name) => !wanted(name))).toEqual([])
  })

  it('have a message for every code the core and the background answer with', () => {
    const codes = [
      'locked',
      'noVault',
      'notKemlock',
      'sessionEnded',
      'network',
      'rateLimited',
      'auth',
      'forbidden',
      'notFound',
      'conflict',
      'badRequest',
      'server',
      'proofNeeded',
      'pieceMismatch',
      'phraseMismatch',
      'noKey',
      'expired',
      'changed',
      'badBundle',
      'unreadable',
      'pieceFormat',
      'pieceChecksum',
      'pieceOtherKit',
      'pieceDuplicate',
      'pieceNotEnough',
      'filesNeedPhone',
      'moveTooLate',
      'moveDone',
    ]
    expect(codes.filter((code) => !(`account_error_${code}` in en))).toEqual([])
  })

  it('write French that is French, not English again', () => {
    const same = Object.entries(en)
      .filter(([name, value]) => fr[name] === value)
      .map(([name]) => name)
      .sort()
    // Names, codes and numbers that read the same in both languages
    expect(same).toEqual([
      'account_approvals_from',
      'account_kind_amethystora',
      'account_move_kind_contact',
      'account_move_kind_note',
      'account_move_kind_otp',
      'account_move_screenRunning',
      'account_proof_label',
      'account_recovery_have',
      'account_steps_code',
      'account_steps_secretLabel',
    ])
  })
})
