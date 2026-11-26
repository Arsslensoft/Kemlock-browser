// A code on show: a row of the list, the line of a card or a login's page, and the backup codes of a service.
import { useState } from 'preact/hooks'
import type { BackupCodeView, CodeView } from '../shared/api'
import { IconButton, LinkButton, Ring, Tile, useToast, Button } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { useCopy, useFlash } from './copy'
import { groupCode, hostOf } from './format'
import { secondsLeft, warnSeconds, type Live } from './live'
import { ask } from './send'
import { FieldsSection, LinksSection } from './item-extras'
import type { Route } from './route'
import { SpaceBadge } from './spaces'

/** What a code is called: the name it was given, else its issuer, else its account. */
export function codeName(code: CodeView): string {
  const name = code.name?.trim() ?? ''
  return name !== '' ? name : code.issuer !== '' ? code.issuer : code.account
}

/** The websites a code is used on, as hosts: a line under its name. */
export function siteLine(websites: string[] | undefined): string {
  return [...new Set((websites ?? []).map(hostOf))].join(' · ')
}

/** What the live code of a card or row says: its digits, its seconds left, and the next code in its last seconds. */
function useLiveCode(code: CodeView, live: Live) {
  const say = useToast()
  const entry = live.entries[code.id]
  const left = entry === undefined ? undefined : secondsLeft(entry, live.now)
  const warn = left !== undefined && left <= warnSeconds
  const nextHotp = async () => {
    try {
      live.hold(code.id, await ask('nextHotp', { id: code.id }))
    } catch (error) {
      say(errorMessage(error))
    }
  }
  return { entry, left, warn, nextHotp }
}

/**
 * A code's line in a card or on a login's page: its ring, its digits with the next code in the last
 * seconds, the HOTP counter button and Copy. A code kept on a security key is named instead.
 */
export function CodeLine(props: {
  code: CodeView
  live: Live
  variant: 'card' | 'detail'
  /** Under the digits, when the next code isn't there. */
  sub?: string
}) {
  const { code, live, variant } = props
  const copy = useCopy()
  const { entry, left, warn, nextHotp } = useLiveCode(code, live)
  const name = codeName(code)
  if (code.onSecurityKey) {
    return (
      <div class="code-line">
        <span class="muted security-key">
          <Icon name="shield" size={16} />
          <span>{t('popup_onSecurityKey')}</span>
        </span>
      </div>
    )
  }
  const ringSize = variant === 'card' ? 28 : 26
  return (
    <div class={`code-line ${variant === 'card' ? 'inline' : 'detail'}`}>
      {left !== undefined && (
        <Ring
          remaining={left}
          period={code.period}
          warn={warn}
          size={ringSize}
          label={t('popup_secondsLeft', left)}
        />
      )}
      <span class="grow code-text">
        <span class={warn ? 'mono code warn' : 'mono code'}>
          {entry === undefined ? '······' : groupCode(entry.code)}
        </span>
        {warn && entry?.next !== undefined ? (
          <span class="mono next">
            {t('popup_next')} {groupCode(entry.next)}
          </span>
        ) : (
          props.sub !== undefined && <span class="sub">{props.sub}</span>
        )}
      </span>
      {code.type === 'hotp' && (
        <IconButton icon="refresh" label={t('popup_nextCodeOf', name)} onClick={nextHotp} />
      )}
      {variant === 'card' ? (
        <IconButton
          icon="copy"
          size={16}
          label={t('popup_copyCodeOf', name)}
          disabled={entry === undefined}
          onClick={() => void copy('code', code.id)}
        />
      ) : (
        <LinkButton
          label={t('popup_copyCodeOf', name)}
          disabled={entry === undefined}
          onClick={() => void copy('code', code.id)}
        >
          {t('popup_copy')}
        </LinkButton>
      )}
    </div>
  )
}

/** One row of the Codes list: a tap copies the code. Its order and tags are changed on their own pages (the vault tools). */
export function CodeRow(props: {
  code: CodeView
  live: Live
  /** Opens the code's edit page (its name, websites, fields and links). */
  onEdit?: (id: string) => void
}) {
  const { code, live } = props
  const copy = useCopy()
  const [copied, flash] = useFlash()
  const { entry, warn, nextHotp } = useLiveCode(code, live)
  const name = codeName(code)
  const sites = siteLine(code.websites)
  const edit = props.onEdit !== undefined && (
    <IconButton
      icon="edit"
      size={16}
      label={t('extras_editCodeOf', name)}
      onClick={() => props.onEdit?.(code.id)}
    />
  )
  const text = (
    <>
      <Tile name={name} />
      <span class="grow lines">
        <span class="name ellipsis">{name}</span>
        {(code.issuer !== '' || name !== code.account) && (
          <span class="label ellipsis">{code.account}</span>
        )}
        {sites !== '' && <span class="label ellipsis">{sites}</span>}
        <SpaceBadge space={code.space} />
      </span>
    </>
  )
  if (code.onSecurityKey) {
    return (
      <li class="item">
        <div class="item-main">
          {text}
          <span class="muted security-key">
            <Icon name="shield" size={16} />
            <span>{t('popup_onSecurityKey')}</span>
          </span>
        </div>
        {edit}
      </li>
    )
  }
  return (
    <li class={copied ? 'item copied' : 'item'}>
      <button
        type="button"
        class="item-main hov"
        aria-label={t('popup_copyCodeOf', name)}
        disabled={entry === undefined}
        onClick={() =>
          void copy('code', code.id).then((ok) => {
            if (ok) flash()
          })
        }
      >
        {text}
        <span class="value">
          <span class={warn ? 'mono code warn' : 'mono code'}>
            {entry === undefined ? '······' : groupCode(entry.code)}
          </span>
          <span class={copied ? 'mono sub copied-mark' : 'mono sub'}>
            {copied
              ? t('popup_copied')
              : warn && entry?.next !== undefined
                ? `${t('popup_next')} ${groupCode(entry.next)}`
                : ''}
          </span>
        </span>
      </button>
      {code.type === 'hotp' && (
        <IconButton icon="refresh" label={t('popup_nextCodeOf', name)} onClick={nextHotp} />
      )}
      {edit}
    </li>
  )
}

/** What a service's backup codes are called: the name they were given, else the service's. */
export function backupName(backup: BackupCodeView): string {
  const name = backup.name?.trim() ?? ''
  return name !== '' ? name : backup.issuer
}

/** A tick-box row of pips: `left` of `total` backup codes still unused. */
function Pips(props: { left: number; total: number; label: string }) {
  return (
    <div
      class="pips"
      role="img"
      aria-label={props.label}
      style={{ gridTemplateColumns: `repeat(${Math.max(props.total, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: props.total }, (_, index) => (
        <span key={index} class={index < props.left ? 'pip on' : 'pip'} />
      ))}
    </div>
  )
}

/**
 * Backup codes: how many are left, Copy for the next one and Mark used, and a service's own page
 * to edit them. Free, as everything in Kemlock for browsers is.
 */
export function BackupCodes(props: {
  backups: BackupCodeView[]
  onChanged: () => Promise<void>
  /** Opens a service's own page, where its codes are edited (the vault tools). */
  onOpen?: (serviceId: string) => void
  /** Opens the service's edit page (its name, websites, note, fields and links). */
  onEdit?: (serviceId: string) => void
  /** Opens a linked item's page. */
  onRoute?: (route: Route) => void
}) {
  const copy = useCopy()
  const say = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const markUsed = async (serviceId: string) => {
    setBusy(serviceId)
    try {
      await ask('useBackupCode', { serviceId })
      await props.onChanged()
    } catch (error) {
      say(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {props.backups.map((backup) => {
        const count = t('popup_backupCount', backup.left, backup.total)
        const title = backupName(backup)
        const sites = siteLine(backup.websites)
        return (
          <article class="group pad backup" key={backup.serviceId} aria-label={title}>
            <div class="row">
              <Tile name={title} />
              <span class="grow lines">
                <span class="name">{title}</span>
                {sites !== '' && <span class="label ellipsis">{sites}</span>}
                <span
                  class={backup.left === 0 || backup.low === true ? 'label warn-text' : 'label'}
                >
                  {count}
                </span>
              </span>
              {props.onEdit !== undefined && (
                <IconButton
                  icon="edit"
                  size={16}
                  label={t('extras_editBackupOf', title)}
                  onClick={() => props.onEdit?.(backup.serviceId)}
                />
              )}
              {props.onOpen !== undefined && (
                <LinkButton
                  label={t('tools_manageCodesOf', title)}
                  onClick={() => props.onOpen?.(backup.serviceId)}
                >
                  {t('tools_manage')}
                </LinkButton>
              )}
            </div>
            <Pips left={backup.left} total={backup.total} label={count} />
            <div class="actions split">
              <Button
                disabled={backup.left === 0}
                label={t('popup_copyBackupOf', title)}
                onClick={() => void copy('backupCode', backup.serviceId)}
              >
                {t('popup_copy')}
              </Button>
              <Button
                disabled={backup.left === 0}
                busy={busy === backup.serviceId}
                label={t('popup_markUsedOf', title)}
                onClick={() => void markUsed(backup.serviceId)}
              >
                {t('popup_markUsed')}
              </Button>
            </div>
            <FieldsSection
              item={{ kind: 'backup-codes', id: backup.serviceId }}
              fields={backup.fields}
            />
            {(backup.links ?? 0) > 0 && (
              <LinksSection
                item={{ kind: 'backup-codes', id: backup.serviceId }}
                onRoute={props.onRoute}
                onChanged={() => void props.onChanged()}
              />
            )}
          </article>
        )
      })}
    </>
  )
}
