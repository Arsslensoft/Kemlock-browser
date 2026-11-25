// The account's devices, and signing another one out (its session ends and its key copy is deleted).
import { useState } from 'preact/hooks'
import type { DeviceView } from '../shared/account'
import {
  Badge,
  Button,
  Confirm,
  Group,
  Notice,
  Section,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { described } from './errors'
import { kindName, lastSeen } from './format'
import { account } from './send'
import { useRunner } from './use'

export function DevicesPanel() {
  const say = useToast()
  const devices = useLoad(async () => (await described(account('devices'))).devices)
  const runner = useRunner()
  const [asking, setAsking] = useState<DeviceView | null>(null)
  const now = Date.now()

  const signOut = (device: DeviceView) =>
    void runner.run(async () => {
      await account('signOutDevice', { deviceId: device.id })
      setAsking(null)
      say(t('account_devices_signedOut', device.name))
      await devices.reload()
    })

  return (
    <Section title={t('account_devices_title')}>
      <p class="lead">{t('account_devices_lead')}</p>
      {devices.error !== undefined ? <Notice kind="error">{devices.error}</Notice> : null}
      {runner.error !== null ? <Notice kind="error">{runner.error}</Notice> : null}
      {devices.value === undefined ? (
        devices.loading ? (
          <p class="muted" role="status">
            {t('account_loading')}
          </p>
        ) : null
      ) : (
        <Group>
          {devices.value.map((device) => (
            <div class="item" key={device.id}>
              <div class="grow">
                <div class="row names">
                  <span class="strong">{device.name}</span>
                  {device.current ? <Badge kind="accent">{t('account_devices_this')}</Badge> : null}
                  {device.trusted ? <Badge>{t('account_devices_trusted')}</Badge> : null}
                </div>
                <div class="muted small">
                  {kindName(device.kind)} ·{' '}
                  {t('account_devices_lastSeen', lastSeen(device.lastSeen, now))}
                </div>
              </div>
              {device.current ? null : (
                <Button
                  kind="danger"
                  disabled={runner.busy}
                  label={t('account_devices_signOutFor', device.name)}
                  onClick={() => setAsking(device)}
                >
                  {t('account_devices_signOut')}
                </Button>
              )}
            </div>
          ))}
        </Group>
      )}
      {asking !== null ? (
        <Confirm
          title={t('account_devices_confirmTitle', asking.name)}
          body={t('account_devices_confirmBody')}
          confirmLabel={t('account_devices_signOut')}
          cancelLabel={t('account_cancel')}
          danger
          busy={runner.busy}
          onCancel={() => setAsking(null)}
          onConfirm={() => signOut(asking)}
        />
      ) : null}
    </Section>
  )
}
