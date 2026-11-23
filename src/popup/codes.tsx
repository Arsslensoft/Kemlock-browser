// A code on show: its digits and countdown, and the backup codes of a service.
import { useState } from 'preact/hooks'
import type { BackupCodeView, CodeView } from '../shared/api'
import { Badge, Button, IconButton, Ring, useToast } from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { useCopy } from './copy'
import { groupCode } from './format'
import { secondsLeft, warnSeconds, type Live } from './live'
import { ask } from './send'

export function codeName(code: CodeView): string {
  return code.issuer !== '' ? code.issuer : code.account
}

/**
 * The right-hand side of a code's row or card: the code, its ring, the next code in its last
 * seconds, the HOTP counter button and Copy. A code kept on a security key is named instead.
 */
export function CodeValue(props: { code: CodeView; live: Live }) {
  const { code, live } = props
  const copy = useCopy()
  const say = useToast()
  if (code.onSecurityKey) {
    return (
      <span class="muted security-key">
        <Icon name="shield" size={16} />
        <span>{t('popup_onSecurityKey')}</span>
      </span>
    )
  }
  const entry = live.entries[code.id]
  const left = entry === undefined ? undefined : secondsLeft(entry, live.now)
  const warn = left !== undefined && left <= warnSeconds
  const name = codeName(code)

  const nextHotp = async () => {
    try {
      live.hold(code.id, await ask('nextHotp', { id: code.id }))
    } catch (error) {
      say(errorMessage(error))
    }
  }

  return (
    <div class="code-value">
      <div class="code-digits">
        <span class={warn ? 'mono code warn' : 'mono code'}>
          {entry === undefined ? '······' : groupCode(entry.code)}
        </span>
        {warn && entry?.next !== undefined && (
          <span class="muted small mono next">
            {t('popup_next')} {groupCode(entry.next)}
          </span>
        )}
      </div>
      {left !== undefined && (
        <Ring
          remaining={left}
          period={code.period}
          warn={warn}
          label={t('popup_secondsLeft', left)}
        />
      )}
      {code.type === 'hotp' && (
        <IconButton icon="refresh" label={t('popup_nextCodeOf', name)} onClick={nextHotp} />
      )}
      <IconButton
        icon="copy"
        label={t('popup_copyCodeOf', name)}
        disabled={entry === undefined}
        onClick={() => void copy('code', code.id)}
      />
    </div>
  )
}

/** One row of the Codes list. The vault's order and tags are shown here and changed nowhere. */
export function CodeRow(props: { code: CodeView; live: Live }) {
  const { code } = props
  return (
    <li class="item">
      <div class="grow">
        <div class="strong ellipsis">{codeName(code)}</div>
        {code.issuer !== '' && <div class="muted small ellipsis">{code.account}</div>}
        {(code.tags.length > 0 || code.backupCodesLeft !== undefined) && (
          <div class="chips">
            {code.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            {code.backupCodesLeft !== undefined && (
              <Badge kind="accent">{t('popup_backupCodesLeft', code.backupCodesLeft)}</Badge>
            )}
          </div>
        )}
      </div>
      <CodeValue code={code} live={props.live} />
    </li>
  )
}

/**
 * Backup codes: how many are left, Copy for the next one and Mark used. No tool to get new codes,
 * locked or not: Kemlock for browsers sells nothing.
 */
export function BackupCodes(props: { backups: BackupCodeView[]; onChanged: () => Promise<void> }) {
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
    <ul class="list">
      {props.backups.map((backup) => (
        <li class="item" key={backup.serviceId}>
          <div class="grow">
            <div class="strong ellipsis">{backup.issuer}</div>
            <div class="muted small">{t('popup_backupCount', backup.left, backup.total)}</div>
          </div>
          <Button
            disabled={backup.left === 0}
            label={t('popup_copyBackupOf', backup.issuer)}
            onClick={() => void copy('backupCode', backup.serviceId)}
          >
            {t('popup_copy')}
          </Button>
          <Button
            disabled={backup.left === 0}
            busy={busy === backup.serviceId}
            label={t('popup_markUsedOf', backup.issuer)}
            onClick={() => void markUsed(backup.serviceId)}
          >
            {t('popup_markUsed')}
          </Button>
        </li>
      ))}
    </ul>
  )
}
