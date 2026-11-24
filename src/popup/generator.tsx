// The password generator: the app's choices and defaults, remembered in this browser only.
import { useEffect, useId, useState } from 'preact/hooks'
import {
  Button,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Switch,
  useToastBottom,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import {
  defaultChoices,
  lengthRange,
  loadChoices,
  saveChoices,
  separators,
  toOptions,
  wordsRange,
  type Choices,
} from './choices'
import { useCopy } from './copy'
import { ask } from './send'

const separatorNames: Record<string, string> = {
  '-': 'popup_separatorDash',
  ' ': 'popup_separatorSpace',
  '.': 'popup_separatorDot',
  _: 'popup_separatorUnderscore',
}

const separatorMarks: Record<string, string> = { '-': '-', ' ': '␣', '.': '.', _: '_' }

/** What the choices are worth, in bits: a rough measure of how many tries a guess would take. */
export function bitsOf(choices: Choices): number {
  if (choices.mode === 'passphrase') {
    return Math.round(
      choices.words * Math.log2(7776) + (choices.includeNumber ? Math.log2(10 * choices.words) : 0),
    )
  }
  const lower = choices.avoidLookAlikes ? 25 : 26
  const upper = choices.capitals ? (choices.avoidLookAlikes ? 24 : 26) : 0
  const digits = choices.digits ? (choices.avoidLookAlikes ? 8 : 10) : 0
  const symbols = choices.symbols ? 7 : 0
  return Math.round(choices.length * Math.log2(lower + upper + digits + symbols))
}

/** 1 to 4, as the bars show it. */
export function levelOf(bits: number): number {
  return bits < 50 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4
}

const levelNames = ['', 'popup_strength1', 'popup_strength2', 'popup_strength3', 'popup_strength4']

function Range(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div class="range">
      <div class="range-head">
        <label for={id}>{props.label}</label>
        <span class="mono">{props.value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </div>
  )
}

function Characters(props: { value: string }) {
  return (
    <>
      {[...props.value].map((ch, index) => (
        <span
          key={index}
          class={/[0-9]/.test(ch) ? 'ch digit' : /[A-Za-z]/.test(ch) ? 'ch' : 'ch symbol'}
        >
          {ch}
        </span>
      ))}
    </>
  )
}

export function Generator(props: { onBack: () => void; onRecent: () => void }) {
  const [choices, setChoices] = useState<Choices | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [round, setRound] = useState(0)
  const copy = useCopy()
  useToastBottom(76)

  useEffect(() => {
    let alive = true
    void loadChoices().then((stored) => alive && setChoices(stored))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (choices === null) return
    let alive = true
    void saveChoices(choices)
    ask('generate', { options: toOptions(choices) }).then(
      (made) => {
        if (!alive) return
        setValue(made)
        setError(undefined)
      },
      (failure) => alive && setError(errorMessage(failure)),
    )
    return () => {
      alive = false
    }
  }, [choices, round])

  const shown = choices ?? defaultChoices
  const change = (patch: Partial<Choices>) => setChoices({ ...shown, ...patch })
  const bits = bitsOf(shown)
  const level = levelOf(bits)

  return (
    <div class="screen">
      <PageHeader title={t('popup_generator')} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body generator-body">
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        <Group pad accent>
          <output
            class="generated mono"
            aria-live="polite"
            aria-label={t('popup_generatedPassword')}
          >
            <Characters value={value} />
          </output>
          <div class="strength">
            <div class={`bars level-${level}`} aria-hidden="true">
              {[1, 2, 3, 4].map((step) => (
                <span key={step} class={step <= level ? 'on' : ''} />
              ))}
            </div>
            <span class={`strength-name level-${level}`}>
              {t('popup_strengthBits', t(levelNames[level]!), bits)}
            </span>
            <IconButton
              icon="refresh"
              size={16}
              weight={2}
              label={t('popup_generate')}
              onClick={() => setRound((n) => n + 1)}
            />
            <IconButton
              icon="copy"
              size={16}
              label={t('popup_copy')}
              disabled={value === ''}
              onClick={() => void copy('generated', 'generator', value)}
            />
          </div>
        </Group>

        <fieldset class="kind">
          <legend class="visually-hidden">{t('popup_make')}</legend>
          {(['random', 'passphrase'] as const).map((mode) => (
            <label key={mode} class={shown.mode === mode ? 'choice on' : 'choice'}>
              <input
                type="radio"
                name="mode"
                value={mode}
                checked={shown.mode === mode}
                onChange={() => change({ mode })}
              />
              <span>{t(mode === 'random' ? 'popup_random' : 'popup_passphrase')}</span>
            </label>
          ))}
        </fieldset>

        <Group>
          {shown.mode === 'random' ? (
            <>
              <Range
                label={t('popup_length')}
                value={shown.length}
                min={lengthRange.min}
                max={lengthRange.max}
                onChange={(length) => change({ length })}
              />
              <Switch
                label={t('popup_capitals')}
                checked={shown.capitals}
                onChange={(capitals) => change({ capitals })}
              />
              <Switch
                label={t('popup_digits')}
                checked={shown.digits}
                onChange={(digits) => change({ digits })}
              />
              <Switch
                label={t('popup_symbols')}
                checked={shown.symbols}
                onChange={(symbols) => change({ symbols })}
              />
              <Switch
                label={t('popup_lookAlikes')}
                checked={shown.avoidLookAlikes}
                onChange={(avoidLookAlikes) => change({ avoidLookAlikes })}
              />
            </>
          ) : (
            <>
              <Range
                label={t('popup_words')}
                value={shown.words}
                min={wordsRange.min}
                max={wordsRange.max}
                onChange={(words) => change({ words })}
              />
              <Switch
                label={t('popup_capitalise')}
                checked={shown.capitalize}
                onChange={(capitalize) => change({ capitalize })}
              />
              <Switch
                label={t('popup_addDigit')}
                checked={shown.includeNumber}
                onChange={(includeNumber) => change({ includeNumber })}
              />
              <div class="separator-row">
                <span id="separator-label">{t('popup_separator')}</span>
                <div class="seg" role="group" aria-labelledby="separator-label">
                  {separators.map((separator) => (
                    <button
                      key={separator}
                      type="button"
                      class={shown.separator === separator ? 'mono on' : 'mono'}
                      aria-pressed={shown.separator === separator ? 'true' : 'false'}
                      aria-label={t(separatorNames[separator] ?? 'popup_separatorDash')}
                      onClick={() => change({ separator })}
                    >
                      {separatorMarks[separator] ?? separator}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Group>
        <p class="note-faint">
          {t(shown.mode === 'random' ? 'popup_generatorNote' : 'popup_generatorNoteWords')}
        </p>
      </div>
      <div class="foot-bar">
        <Button onClick={() => setRound((n) => n + 1)}>{t('popup_generate')}</Button>
        <Button kind="primary" class="wide" onClick={props.onRecent}>
          {t('popup_recent')}
        </Button>
      </div>
    </div>
  )
}
