// Sends in the popup (docs/plans/add-sends.md): the account's list, a way into the Sends tab to make one or open one, and a word where
// Sends can't be (a vault that doesn't sync with Kemlock Server). Making and opening happen in a tab, since choosing a file closes the popup.
import { useState } from 'preact/hooks'
import {
  Button,
  Confirm,
  IconButton,
  Notice,
  PageHeader,
  Section,
  Tile,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import type { ForeignSendView, SendFailure, SendView } from '../shared/sends'
import {
  sendDeletesText,
  sendKindText,
  sendProblemText,
  sendStatusText,
  sendSummary,
} from '../shared/sends-text'
import { openSetup } from './links'
import type { Route } from './route'
import { ask } from './send'

/**
 * The Sends tab, on one of its pages. A tab, not the popup: choosing a file closes the popup. `draft` is the token of a note's text
 * the background holds for New Send (`sendFromNote`): only the token is in the address, never the text.
 */
export function openSendsTab(page: 'new' | 'open', draft?: string): void {
  const hash = page === 'new' && draft !== undefined ? `new:${draft}` : page
  void chrome.tabs.create({ url: chrome.runtime.getURL(`src/sends/index.html#${hash}`) })
}

/** Home's way in. */
export function SendsEntry(props: { onOpen: () => void }) {
  return (
    <button type="button" class="link-card hov" onClick={props.onOpen}>
      <Icon name="link" size={16} weight={2} />
      <span class="grow lines">
        <span class="name">{t('sends_title')}</span>
        <span class="label">{t('sends_subtitle')}</span>
      </span>
      <Icon name="chevron" size={16} weight={2} />
    </button>
  )
}

function SendRow(props: { send: SendView; onOpen: (id: string) => void }) {
  const { send } = props
  const name = send.readable && send.name !== undefined ? send.name : t('sends_status_unreadable')
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('sends_openSend', name)}
        onClick={() => props.onOpen(send.id)}
      >
        <Tile name={name} />
        <span class="grow lines">
          <span class="name ellipsis">{name}</span>
          <span class="label ellipsis">
            {send.readable ? sendSummary(send) : sendKindText(send.kind)}
          </span>
        </span>
        <Icon name="chevron" size={16} weight={2} />
      </button>
    </li>
  )
}

/** One of the Sends a Bitwarden app made: named by its kind, listed with its status, and deleted from here. */
function ForeignRow(props: { send: ForeignSendView; onDelete: (send: ForeignSendView) => void }) {
  const { send } = props
  const name = t(send.kind === 'file' ? 'sends_foreignFile' : 'sends_foreignText')
  return (
    <li class="item">
      <div class="item-main">
        <Tile name={name} />
        <span class="grow lines">
          <span class="name ellipsis">{name}</span>
          <span class="label ellipsis">
            {[sendStatusText(send.status), sendDeletesText(send.deletionAt)].join(' · ')}
          </span>
        </span>
      </div>
      <IconButton
        icon="trash"
        size={16}
        label={t('sends_deleteSend', name)}
        onClick={() => props.onDelete(send)}
      />
    </li>
  )
}

/** Where Sends aren't: the vault syncs with another place or none. Opening a Send someone gave you still works. */
function Unavailable(props: { failure: SendFailure }) {
  return (
    <>
      <Notice kind="info">{sendProblemText(props.failure)}</Notice>
      <div class="actions start">
        <Button onClick={() => openSetup('again')}>{t('popup_setUpSync')}</Button>
      </div>
    </>
  )
}

export function SendsPage(props: { onBack: () => void; onRoute: (route: Route) => void }) {
  const listing = useLoad(() => ask('sends'))
  const say = useToast()
  const [asking, setAsking] = useState<ForeignSendView | undefined>()
  const [busy, setBusy] = useState(false)
  const { value, error } = listing
  const available = value !== undefined && value.ok && value.value.available

  const deleteForeign = async (send: ForeignSendView) => {
    setBusy(true)
    try {
      const result = await ask('sendDelete', { id: send.id })
      if (!result.ok) say(sendProblemText(result))
      else say(t('sends_deleted'))
      setAsking(undefined)
      await listing.reload()
    } catch (failure) {
      say(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const body = () => {
    if (value === undefined)
      return error === undefined ? (
        <p class="muted" role="status">
          {t('popup_loading')}
        </p>
      ) : (
        <Notice kind="error">{error}</Notice>
      )
    if (!value.ok)
      return (
        <>
          <Notice kind="error">{sendProblemText(value)}</Notice>
          <div class="actions start">
            <Button onClick={() => void listing.reload()}>{t('sends_retry')}</Button>
          </div>
        </>
      )
    const list = value.value
    if (!list.available) return <Unavailable failure={{ problem: 'noSync', place: list.place }} />
    if (list.sends.length === 0 && list.foreign.length === 0)
      return (
        <div class="empty-state">
          <span class="empty-icon" aria-hidden="true">
            <Icon name="link" size={30} weight={1.6} />
          </span>
          <div class="empty-words">
            <p class="empty-title">{t('sends_emptyTitle')}</p>
            <p class="empty-rest">{t('sends_emptyBody')}</p>
          </div>
          <Button kind="primary" icon="plus" onClick={() => openSendsTab('new')}>
            {t('sends_new')}
          </Button>
        </div>
      )
    return (
      <>
        {list.sends.length > 0 && (
          <ul class="list">
            {list.sends.map((send) => (
              <SendRow
                key={send.id}
                send={send}
                onOpen={(id) => props.onRoute({ name: 'send', id })}
              />
            ))}
          </ul>
        )}
        {list.foreign.length > 0 && (
          <Section title={t('sends_foreignTitle')}>
            <p class="muted">{t('sends_foreignNote')}</p>
            {asking !== undefined && (
              <Confirm
                title={t('sends_deleteTitle')}
                body={t('sends_foreignDeleteBody')}
                confirmLabel={t('popup_delete')}
                cancelLabel={t('popup_cancel')}
                danger
                busy={busy}
                onCancel={() => setAsking(undefined)}
                onConfirm={() => void deleteForeign(asking)}
              />
            )}
            <ul class="list">
              {list.foreign.map((send) => (
                <ForeignRow key={send.id} send={send} onDelete={setAsking} />
              ))}
            </ul>
          </Section>
        )}
      </>
    )
  }

  return (
    <div class="screen">
      <PageHeader title={t('sends_title')} onBack={props.onBack} backLabel={t('popup_back')}>
        <IconButton
          icon="plus"
          weight={2}
          label={t('sends_new')}
          disabled={!available}
          onClick={() => openSendsTab('new')}
        />
      </PageHeader>
      <div class="body tight">
        {body()}
        <button type="button" class="link-card hov" onClick={() => openSendsTab('open')}>
          <Icon name="link" size={16} weight={2} />
          <span class="grow lines">
            <span class="name">{t('sends_open')}</span>
            <span class="label">{t('sends_openBody')}</span>
          </span>
          <Icon name="chevron" size={16} weight={2} />
        </button>
      </div>
    </div>
  )
}
