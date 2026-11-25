// The keys screens: the list of keys and contacts, a key's page, adding a key or a contact, and the PGP tools. They are one
// stack of pages, shown in the toolbar popup and again, wider, in the keys tab (src/keys) where a file can be chosen.
import './keys.css'
import { useState } from 'preact/hooks'
import { Notice, useLoad } from '../../shared/ui/components'
import { t } from '../../shared/ui/i18n'
import { AddKey } from './add-key'
import { AddContact, ContactPage } from './contacts'
import { loadKeys, type KeysData } from './data'
import { KeyPage } from './key-page'
import { KeysList } from './list'
import type { KeysRoute } from './route'
import { Tools } from './tools'

export type { KeysRoute } from './route'

export function KeysScreen(props: {
  /** Leaves the screens (the popup's Back to Home); the keys tab has nowhere to go back to. */
  onBack?: () => void
  start?: KeysRoute
}) {
  const loaded = useLoad(loadKeys)
  const [stack, setStack] = useState<KeysRoute[]>([props.start ?? { name: 'list' }])
  const [listTab, setListTab] = useState<'keys' | 'contacts'>(
    props.start?.name === 'list' && props.start.tab === 'contacts' ? 'contacts' : 'keys',
  )
  const route = stack[stack.length - 1] ?? { name: 'list' }
  const go = (next: KeysRoute) => setStack((previous) => [...previous, next])
  const back = () => {
    if (stack.length > 1) setStack((previous) => previous.slice(0, -1))
    else props.onBack?.()
  }
  /** Shows what was just added, in place of the page that added it. */
  const replace = (next: KeysRoute) => setStack((previous) => [...previous.slice(0, -1), next])

  if (loaded.value === undefined) {
    return loaded.error !== undefined ? (
      <main class="screen pad">
        <Notice kind="error">{loaded.error}</Notice>
      </main>
    ) : (
      <div class="screen pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }
  const data: KeysData = { ...loaded.value, reload: loaded.reload }

  switch (route.name) {
    case 'key':
      return <KeyPage id={route.id} data={data} onBack={back} onRoute={go} />
    case 'addKey':
      return (
        <AddKey
          data={data}
          initialText={route.text}
          onBack={back}
          onRoute={replace}
          onAdded={(id) => replace({ name: 'key', id })}
        />
      )
    case 'contact':
      return <ContactPage id={route.id} data={data} onBack={back} onRoute={go} />
    case 'addContact':
      return (
        <AddContact
          data={data}
          initialText={route.text}
          onBack={back}
          onAdded={(id) => {
            setListTab('contacts')
            if (id === null) back()
            else replace({ name: 'contact', id })
          }}
        />
      )
    case 'tools':
      return <Tools data={data} tool={route.tool} keyId={route.keyId} onBack={back} onRoute={go} />
    default:
      return (
        <KeysList data={data} tab={listTab} onTab={setListTab} onRoute={go} onBack={props.onBack} />
      )
  }
}
