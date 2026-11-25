// The menu on a card or identity field (docs/plans/add-items.md): the person's cards or identities by name, never their numbers
// or documents, and a click that fills them. A frame other than the tab's top frame, or an http page, asks the person first, on
// a screen that shows the frame's own address; the background checks the same whatever this page says (decision 1). Clicks count
// only through the click gate, as everywhere in the menu.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { MenuCard, MenuIdentity, MenuView, PendingSave } from '../shared/api'
import { monthYearText } from '../shared/card'
import { ask } from './ask'
import type { Channel, Init } from './channel'
import type { Ignored, Verdict } from './gate'
import { search, tileHue, tileLetter } from './model'
import { t } from './text'

/** The sentence that says why a click was ignored (spec: "say why"). */
function ignoredText(why: Ignored): string {
  switch (why) {
    case 'wait':
      return t('menu_gate_wait')
    case 'faded':
      return t('menu_gate_faded')
    case 'covered':
      return t('menu_gate_covered')
    default:
      return t('menu_gate_hidden')
  }
}

/** A click or Enter: where in the frame it happened, or null for a key. */
interface Press {
  x: number | null
  y: number | null
}

const pressOf = (event: MouseEvent): Press =>
  event.detail === 0 ? { x: null, y: null } : { x: event.clientX, y: event.clientY }

/** Runs [action] only when the gate lets this press count, else says why. */
function useGuarded(channel: Channel) {
  const [notice, setNotice] = useState<string | null>(null)
  const guarded = useCallback(
    async (press: Press, action: () => Promise<void>) => {
      const verdict: Verdict = await channel.permit(press.x, press.y)
      if (!verdict.ok) {
        setNotice(ignoredText(verdict.why))
        return
      }
      setNotice(null)
      try {
        await action()
      } catch (error) {
        const word = error instanceof Error ? error.message : ''
        setNotice(
          word === 'insecure'
            ? t('items_menu_insecure')
            : word === 'confirm'
              ? t('items_menu_needsConfirm')
              : word === 'unverified'
                ? t('items_menu_unverified')
                : t('menu_fill_failed'),
        )
      }
    },
    [channel],
  )
  return { notice, guarded }
}

/** What tells a card apart: its brand and last four digits, its expiry, and "expired". */
export function cardDetail(card: MenuCard): string {
  const number =
    card.lastFour === undefined
      ? ''
      : `${card.brand === undefined ? '' : `${card.brand} `}•••• ${card.lastFour}`
  const expiry = monthYearText(card.expMonth, card.expYear)
  return [number, expiry, card.expired ? t('items_menu_expired') : '']
    .filter((part) => part !== '')
    .join(' · ')
}

/** What tells an identity apart: its person's name when that is not its own, and its email or company. */
export function identityDetail(identity: MenuIdentity): string {
  return [
    identity.fullName !== undefined && identity.fullName !== identity.name ? identity.fullName : '',
    identity.email ?? identity.company ?? '',
  ]
    .filter((part) => part !== '')
    .join(' · ')
}

type Chosen = { card: MenuCard } | { identity: MenuIdentity }

const chosenName = (chosen: Chosen): string =>
  'card' in chosen ? chosen.card.name : chosen.identity.name

function Tile({ name }: { name: string }) {
  return (
    <span class="tile" aria-hidden="true" style={{ '--hue': String(tileHue(name)) } as never}>
      {tileLetter(name)}
    </span>
  )
}

function Row(props: { title: string; detail: string; onClick: (event: MouseEvent) => void }) {
  return (
    <button type="button" class="row" data-row onClick={props.onClick}>
      <Tile name={props.title} />
      <span class="words">
        <span class="name">{props.title}</span>
        {props.detail !== '' ? <span class="detail">{props.detail}</span> : null}
      </span>
    </button>
  )
}

/** Focuses the first row once, so Enter and the arrows work in a menu opened from the keyboard. */
function useFirstFocus(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    document.querySelector<HTMLElement>('[data-row], input')?.focus()
  }, [ready])
}

export function FormMenu({
  channel,
  init,
  view,
}: {
  channel: Channel
  init: Init
  view: MenuView
}) {
  const { notice, guarded } = useGuarded(channel)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const isCard = view.field.kind === 'card'
  const cards = view.cards ?? []
  const identities = view.identities ?? []
  const gate = view.form
  useFirstFocus(chosen === null)

  // The fill: the frame's own gate is the background's to enforce; `picked` says the person confirmed the address on the next screen
  const fill = (press: Press, item: Chosen, confirmed: boolean) =>
    guarded(press, async () => {
      await ask('fill', {
        tabId: init.tabId,
        frameId: init.frameId,
        fieldId: init.fieldId,
        ...('card' in item ? { cardId: item.card.id } : { identityId: item.identity.id }),
        ...(confirmed ? { picked: true } : {}),
      })
      channel.close(true)
    })

  if (chosen !== null && gate !== undefined) {
    return (
      <Confirm
        chosen={chosen}
        gate={gate}
        notice={notice}
        channel={channel}
        onBack={() => setChosen(null)}
        onFill={(event) => void fill(pressOf(event), chosen, true)}
      />
    )
  }

  const pick = (press: Press, item: Chosen) => {
    // Over https in the top frame the click fills; anywhere else it asks, with the frame's address in front
    if (gate === undefined || !gate.confirm) return void fill(press, item, false)
    setChosen(item)
  }

  const shownCards = search(cards, query, (card) => [
    card.name,
    card.cardholder ?? '',
    card.brand ?? '',
    card.lastFour ?? '',
  ])
  const shownIdentities = search(identities, query, (identity) => [
    identity.name,
    identity.fullName ?? '',
    identity.email ?? '',
    identity.company ?? '',
  ])
  const count = isCard ? cards.length : identities.length
  const none = isCard ? shownCards.length === 0 : shownIdentities.length === 0
  return (
    <>
      <p class="lead">{t(isCard ? 'items_menu_cardTitle' : 'items_menu_identityTitle')}</p>
      {count === 0 ? (
        <p class="muted">{t(isCard ? 'items_menu_noCards' : 'items_menu_noIdentities')}</p>
      ) : (
        <>
          {count > 5 ? (
            <div class="field">
              <input
                type="search"
                class="search"
                aria-label={t('menu_search')}
                placeholder={t('menu_search')}
                value={query}
                onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                autoComplete="off"
              />
            </div>
          ) : null}
          {none ? <p class="muted">{t('menu_picker_none')}</p> : null}
          <div class="rows">
            {isCard
              ? shownCards.map((card) => (
                  <Row
                    key={card.id}
                    title={card.name}
                    detail={cardDetail(card)}
                    onClick={(event) => pick(pressOf(event), { card })}
                  />
                ))
              : shownIdentities.map((identity) => (
                  <Row
                    key={identity.id}
                    title={identity.name}
                    detail={identityDetail(identity)}
                    onClick={(event) => pick(pressOf(event), { identity })}
                  />
                ))}
          </div>
        </>
      )}
      {gate?.confirm === true ? <p class="hint">{t('items_menu_asksFirst')}</p> : null}
      {notice !== null ? (
        <p class="notice" role="alert">
          {notice}
        </p>
      ) : null}
    </>
  )
}

/** The question before a frame that isn't the page's, or a page that isn't secure, is filled: its own address, in front. */
function Confirm(props: {
  chosen: Chosen
  gate: NonNullable<MenuView['form']>
  notice: string | null
  channel: Channel
  onBack: () => void
  onFill: (event: MouseEvent) => void
}) {
  const { gate, channel } = props
  const backButton = useRef<HTMLButtonElement>(null)
  // A click that picked the item must not also press Fill: the gate's delay starts again, and Back is what a key press reaches
  useEffect(() => {
    channel.restart?.()
    backButton.current?.focus()
  }, [channel])
  return (
    <>
      <p class="lead">{t('items_menu_confirmTitle', chosenName(props.chosen))}</p>
      <p class="address">
        <span class="muted">{t('items_menu_confirmAddress')}</span> <strong>{gate.origin}</strong>
      </p>
      {!gate.top && gate.topSite !== undefined ? (
        <p class="muted">{t('items_menu_inFrame', gate.topSite)}</p>
      ) : null}
      {!gate.secure ? (
        <p class="notice" role="alert">
          {t('items_menu_insecure')}
        </p>
      ) : null}
      {props.notice !== null ? (
        <p class="notice" role="alert">
          {props.notice}
        </p>
      ) : null}
      <div class="buttons">
        <button type="button" class="secondary" ref={backButton} onClick={props.onBack}>
          {t('menu_back')}
        </button>
        <button type="button" class="primary" onClick={props.onFill}>
          {t('menu_fill')}
        </button>
      </div>
    </>
  )
}

/** The facts of an identity the save prompt offers: its name, email and address. */
export function IdentityFacts({ identity }: { identity: NonNullable<PendingSave['identity']> }) {
  return (
    <>
      <dt>{t('items_menu_saveIdentityName')}</dt>
      <dd>{identity.name}</dd>
      {identity.email !== undefined ? (
        <>
          <dt>{t('items_menu_saveIdentityEmail')}</dt>
          <dd class="mono">{identity.email}</dd>
        </>
      ) : null}
      {identity.address !== undefined ? (
        <>
          <dt>{t('items_menu_saveIdentityAddress')}</dt>
          <dd>{identity.address}</dd>
        </>
      ) : null}
    </>
  )
}

/** The facts of a card the save prompt offers: its brand and last digits, holder and expiry, never its number. */
export function CardFacts({ card }: { card: NonNullable<PendingSave['card']> }) {
  return (
    <>
      <dt>{t('items_menu_saveCardNumber')}</dt>
      <dd class="mono">{`${card.brand === undefined ? '' : `${card.brand} `}•••• ${card.lastFour}`}</dd>
      {card.holder !== undefined ? (
        <>
          <dt>{t('items_menu_saveCardHolder')}</dt>
          <dd>{card.holder}</dd>
        </>
      ) : null}
      {card.expiry !== undefined ? (
        <>
          <dt>{t('items_menu_saveCardExpiry')}</dt>
          <dd class="mono">{card.expiry}</dd>
        </>
      ) : null}
    </>
  )
}
