// Reorder: the codes or the logins in the order the vault keeps them, moved by dragging a row, or by its Move up and Move down
// buttons (which work from the keyboard), with Pin to keep an item at the top. Codes are saved the way the app saves its custom
// order, so a phone keeps it; the logins' order is this browser's own (the app sorts logins by name).
import { useState } from 'preact/hooks'
import { Notice, PageHeader, Tile, useToast } from '../../shared/ui/components'
import type { OrderedKind } from '../../shared/tools-api'
import { errorMessage, t } from '../../shared/ui/i18n'
import { codeName } from '../codes'
import type { Vault } from '../data'
import { ask } from '../send'
import { ToolIcon, ToolIconButton } from './icons'
import { byPinnedThenOrder, dropped, moved, type Ordered } from './order'

interface Row extends Ordered {
  name: string
  detail: string
}

export function ReorderPage(props: { kind: OrderedKind; vault: Vault; onBack: () => void }) {
  const { vault, kind } = props
  const say = useToast()
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')

  const rows: Row[] =
    kind === 'code'
      ? vault.codes
          .filter((code) => !code.onSecurityKey)
          .map((code) => ({
            id: code.id,
            order: code.order,
            pinned: code.pinned,
            name: codeName(code),
            detail: code.account,
          }))
      : vault.logins.map((login) => ({
          id: login.id,
          order: login.order,
          pinned: login.pinned,
          name: login.name,
          detail: login.username,
        }))
  const sorted = byPinnedThenOrder(rows)

  const save = async (ids: string[] | null, said?: string) => {
    if (ids === null) return
    setBusy(true)
    try {
      await ask('reorder', { itemKind: kind, ids })
      await vault.reload()
      if (said !== undefined) setAnnounce(said)
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const move = (row: Row, delta: -1 | 1) => {
    const ids = moved(rows, row.id, delta)
    const place = ids === null ? 0 : ids.indexOf(row.id) + 1
    void save(ids, t('tools_movedTo', row.name, place, rows.length))
  }

  const pin = async (row: Row) => {
    setBusy(true)
    try {
      await ask('setPinned', { itemKind: kind, id: row.id, pinned: row.pinned !== true })
      await vault.reload()
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="screen">
      <PageHeader
        title={t(kind === 'code' ? 'tools_reorderCodes' : 'tools_reorderLogins')}
        onBack={props.onBack}
        backLabel={t('popup_back')}
      />
      <div class="body">
        <p class="note-text">
          {t(kind === 'code' ? 'tools_reorderCodesNote' : 'tools_reorderLoginsNote')}
        </p>
        {rows.length === 0 && <Notice>{t('tools_nothingToOrder')}</Notice>}
        <ol class="list reorder-list">
          {sorted.map((row, index) => (
            <li
              key={row.id}
              class={dragging === row.id ? 'item reorder-row dragging' : 'item reorder-row'}
              draggable={!busy}
              onDragStart={(event) => {
                setDragging(row.id)
                event.dataTransfer?.setData('text/plain', row.id)
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (dragging !== null) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                const from = dragging
                setDragging(null)
                if (from !== null)
                  void save(
                    dropped(rows, from, row.id),
                    t('tools_movedTo', row.name, index + 1, rows.length),
                  )
              }}
              onDragEnd={() => setDragging(null)}
            >
              <span class="drag-handle" aria-hidden="true">
                <ToolIcon name="grip" size={16} />
              </span>
              <Tile name={row.name} />
              <span class="grow lines">
                <span class="name ellipsis">{row.name}</span>
                {row.detail !== '' && <span class="label ellipsis">{row.detail}</span>}
              </span>
              <ToolIconButton
                icon="pin"
                label={t(row.pinned === true ? 'tools_unpin' : 'tools_pin', row.name)}
                pressed={row.pinned === true}
                disabled={busy}
                onClick={() => void pin(row)}
              />
              <ToolIconButton
                icon="up"
                label={t('tools_moveUp', row.name)}
                disabled={busy || moved(rows, row.id, -1) === null}
                onClick={() => move(row, -1)}
              />
              <ToolIconButton
                icon="down"
                label={t('tools_moveDown', row.name)}
                disabled={busy || moved(rows, row.id, 1) === null}
                onClick={() => move(row, 1)}
              />
            </li>
          ))}
        </ol>
        <p class="visually-hidden" role="status" aria-live="polite">
          {announce}
        </p>
      </div>
    </div>
  )
}
