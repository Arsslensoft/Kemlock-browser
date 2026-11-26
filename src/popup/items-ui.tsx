// What the pages of notes, cards and identities share: a hidden field shown on a click, a row with a copy button, the bar and the
// delete question, and the Fill button's call. Nothing here holds a secret until it is asked to show one, for half a minute.
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { TabView } from '../shared/api'
import { KemlockIcon } from '../shared/brand/brand'
import { Confirm, IconButton, Tile, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import './items.css'
import { ask } from './send'

/** The page's language for names it translates itself (countries): French, else English. */
export function uiLanguage(): string {
  try {
    return chrome.i18n.getUILanguage().toLowerCase().startsWith('fr') ? 'fr' : 'en'
  } catch {
    return 'en'
  }
}

/** A row of a page: a label, a value, and its copy button when it has one. */
export function DetailRow(props: {
  label: string
  value: ComponentChildren
  mono?: boolean
  /** The copy button's accessible name; no button without it. */
  copyLabel?: string
  onCopy?: () => void
  class?: string
}) {
  return (
    <div class={`detail-row${props.class ? ` ${props.class}` : ''}`}>
      <span class="detail-label">{props.label}</span>
      <span class={`grow${props.mono ? ' mono' : ''} item-value`}>{props.value}</span>
      {props.copyLabel !== undefined && props.onCopy !== undefined && (
        <IconButton icon="copy" size={16} label={props.copyLabel} onClick={props.onCopy} />
      )}
    </div>
  )
}

/**
 * A hidden field: dots (or [hidden]) until Show, which asks the background for the value; it hides again after half a minute
 * and when the page goes. Copy goes through the background, which clears the clipboard later.
 */
export function SecretRow(props: {
  label: string
  /** What shows while hidden: "•••• 1111", or dots. */
  hidden: string
  load: () => Promise<string>
  format?: (value: string) => string
  showLabel: string
  hideLabel: string
  copyLabel: string
  onCopy: () => void
  /** A small line under the value ("Visa"). */
  caption?: string
}) {
  const say = useToast()
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (shown === null) return
    const timer = setTimeout(() => setShown(null), 30_000)
    return () => clearTimeout(timer)
  }, [shown])
  const toggle = async () => {
    if (shown !== null) {
      setShown(null)
      return
    }
    try {
      setShown(await props.load())
    } catch (error) {
      say(errorMessage(error))
    }
  }
  return (
    <div class="password-line detail item-secret">
      <span class="lead-label">{props.label}</span>
      {shown === null ? (
        <span class="mono grow secret">
          <span aria-hidden="true">{props.hidden}</span>
          <span class="visually-hidden">{t('items_hidden')}</span>
        </span>
      ) : (
        <span class="mono grow secret revealed">
          {props.format === undefined ? shown : props.format(shown)}
        </span>
      )}
      <IconButton
        icon={shown === null ? 'eye' : 'eyeOff'}
        size={16}
        label={shown === null ? props.showLabel : props.hideLabel}
        onClick={() => void toggle()}
      />
      <IconButton icon="copy" size={16} label={props.copyLabel} onClick={props.onCopy} />
      {props.caption !== undefined && <span class="item-caption label">{props.caption}</span>}
    </div>
  )
}

/**
 * The bar of an item's page: back, the mark, the name, Edit and Delete. An item in a space the
 * person can only read leaves out Edit and Delete, since the core refuses both there anyway.
 */
export function ItemBar(props: {
  name: string
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  deleteLabel: string
  readOnly?: boolean
}) {
  return (
    <header class="bar login-bar">
      <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
      <KemlockIcon size={24} class="mark" />
      <Tile name={props.name} size={32} />
      <h1 class="login-title">{props.name}</h1>
      {props.readOnly !== true && (
        <button type="button" class="link-btn hov" onClick={props.onEdit}>
          {t('popup_edit')}
        </button>
      )}
      {props.readOnly !== true && (
        <IconButton icon="trash" label={props.deleteLabel} onClick={props.onDelete} />
      )}
    </header>
  )
}

/** "Delete this card?", in place, with Cancel focused. */
export function DeleteQuestion(props: {
  title: string
  body: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div class="login-confirm">
      <Confirm
        title={props.title}
        body={props.body}
        confirmLabel={t('popup_delete')}
        cancelLabel={t('popup_cancel')}
        danger
        busy={props.busy}
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
      />
    </div>
  )
}

/** Fills the tab in front with a card or an identity, and says so (or why not) in a toast. */
export function useFillForm(tab: TabView | undefined) {
  const say = useToast()
  return async (args: { cardId: string } | { identityId: string }) => {
    if (tab === undefined) return
    try {
      await ask('fill', { tabId: tab.tabId, ...args })
      say(
        t('cardId' in args ? 'items_cardFilledOn' : 'items_identityFilledOn', tab.match.site),
        t('items_filledSub'),
      )
    } catch (error) {
      say(errorMessage(error))
    }
  }
}
