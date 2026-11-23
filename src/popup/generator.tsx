// The password generator: the app's choices and defaults, remembered in this browser only.
import { useEffect, useId, useState } from 'preact/hooks'
import { Button, Notice, PageHeader, SelectField, Section, Switch } from '../shared/ui/components'
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

function Range(props: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
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

export function Generator(props: { onBack: () => void; onRecent: () => void }) {
  const [choices, setChoices] = useState<Choices | null>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [round, setRound] = useState(0)
  const copy = useCopy()

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

  return (
    <div>
      <PageHeader title={t('popup_generator')} onBack={props.onBack} backLabel={t('popup_back')} />
      <Section>
        {error !== undefined && <Notice kind="error">{error}</Notice>}
        <output class="generated mono" aria-label={t('popup_generatedPassword')}>
          {value}
        </output>
        <div class="actions">
          <Button icon="refresh" onClick={() => setRound((n) => n + 1)}>
            {t('popup_generate')}
          </Button>
          <Button
            kind="primary"
            icon="copy"
            disabled={value === ''}
            onClick={() => void copy('generated', 'generator', value)}
          >
            {t('popup_copy')}
          </Button>
        </div>
      </Section>

      <Section>
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

        {shown.mode === 'random' ? (
          <>
            <Range
              label={t('popup_lengthValue', shown.length)}
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
              detail="0 – 9"
              checked={shown.digits}
              onChange={(digits) => change({ digits })}
            />
            <Switch
              label={t('popup_symbols')}
              detail="! # % & - _ ?"
              checked={shown.symbols}
              onChange={(symbols) => change({ symbols })}
            />
            <Switch
              label={t('popup_lookAlikes')}
              detail={t('popup_lookAlikesDetail')}
              checked={shown.avoidLookAlikes}
              onChange={(avoidLookAlikes) => change({ avoidLookAlikes })}
            />
          </>
        ) : (
          <>
            <Range
              label={t('popup_wordsValue', shown.words)}
              value={shown.words}
              min={wordsRange.min}
              max={wordsRange.max}
              onChange={(words) => change({ words })}
            />
            <SelectField
              label={t('popup_separator')}
              value={shown.separator}
              options={separators.map((separator) => ({
                value: separator as string,
                label: t(separatorNames[separator] ?? 'popup_separatorDash'),
              }))}
              onChange={(separator) => change({ separator })}
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
          </>
        )}
        <p class="muted small">{t('popup_generatorNote')}</p>
      </Section>

      <Section>
        <Button onClick={props.onRecent}>{t('popup_recent')}</Button>
      </Section>
    </div>
  )
}
