// The generator's remembered choices: kept in this browser, never synced.
import type { GeneratorOptions } from '../shared/api'

export interface Choices {
  mode: 'random' | 'passphrase'
  length: number
  capitals: boolean
  digits: boolean
  symbols: boolean
  avoidLookAlikes: boolean
  words: number
  separator: string
  capitalize: boolean
  includeNumber: boolean
}

/** The app's defaults: Random of 20 with capitals, digits and symbols; Passphrase of 5 words. */
export const defaultChoices: Choices = {
  mode: 'random',
  length: 20,
  capitals: true,
  digits: true,
  symbols: true,
  avoidLookAlikes: true,
  words: 5,
  separator: '-',
  capitalize: false,
  includeNumber: false,
}

export const lengthRange = { min: 8, max: 64 } as const
export const wordsRange = { min: 3, max: 10 } as const
export const separators = ['-', ' ', '.', '_'] as const

const storageKey = 'kemlock_popup_generator'

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback

/** What was stored, kept to what the generator accepts. */
export function sanitize(raw: unknown): Choices {
  const stored = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const flag = (name: keyof Choices, fallback: boolean): boolean =>
    typeof stored[name] === 'boolean' ? (stored[name] as boolean) : fallback
  const separator = stored.separator
  return {
    mode: stored.mode === 'passphrase' ? 'passphrase' : 'random',
    length: clamp(stored.length, lengthRange.min, lengthRange.max, defaultChoices.length),
    capitals: flag('capitals', defaultChoices.capitals),
    digits: flag('digits', defaultChoices.digits),
    symbols: flag('symbols', defaultChoices.symbols),
    avoidLookAlikes: flag('avoidLookAlikes', defaultChoices.avoidLookAlikes),
    words: clamp(stored.words, wordsRange.min, wordsRange.max, defaultChoices.words),
    separator:
      typeof separator === 'string' && (separators as readonly string[]).includes(separator)
        ? separator
        : defaultChoices.separator,
    capitalize: flag('capitalize', defaultChoices.capitalize),
    includeNumber: flag('includeNumber', defaultChoices.includeNumber),
  }
}

export async function loadChoices(): Promise<Choices> {
  try {
    const stored = await chrome.storage.local.get(storageKey)
    return sanitize(stored[storageKey])
  } catch {
    return defaultChoices
  }
}

export async function saveChoices(choices: Choices): Promise<void> {
  try {
    await chrome.storage.local.set({ [storageKey]: choices })
  } catch {
    // Remembering is a convenience; the generator works without it.
  }
}

export function toOptions(choices: Choices): GeneratorOptions {
  if (choices.mode === 'passphrase') {
    return {
      mode: 'passphrase',
      words: choices.words,
      separator: choices.separator,
      capitalize: choices.capitalize,
      includeNumber: choices.includeNumber,
    }
  }
  return {
    mode: 'random',
    length: choices.length,
    lowercase: true,
    uppercase: choices.capitals,
    digits: choices.digits,
    symbols: choices.symbols,
    avoidLookAlikes: choices.avoidLookAlikes,
  }
}
