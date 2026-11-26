// A File item's page: its name, kind, size and notes, Download and Copy name, and, where the vault syncs with Kemlock Server, Edit,
// Replace and Delete. The file itself is fetched only on Download, one piece at a time, and let go of as soon as it is saved.
import { useState } from 'preact/hooks'
import type { FileFull } from '../shared/api'
import { KemlockIcon } from '../shared/brand/brand'
import {
  Button,
  Group,
  IconButton,
  Notice,
  PageHeader,
  Tile,
  useLoad,
  useToast,
} from '../shared/ui/components'
import { errorMessage, t } from '../shared/ui/i18n'
import { fileKind, fileSize, openFilesTab, useDownload, useFileSync } from './file-actions'
import { DeleteQuestion, DetailRow } from './items-ui'
import { LinksSection } from './item-extras'
import type { Route } from './route'
import { ask } from './send'

function Message(props: { title: string; kind?: 'error'; children: string; onBack: () => void }) {
  return (
    <div class="screen">
      <PageHeader title={props.title} onBack={props.onBack} backLabel={t('popup_back')} />
      <div class="body">
        <Notice kind={props.kind}>{props.children}</Notice>
      </div>
    </div>
  )
}

export function FilePage(props: {
  id: string
  onBack: () => void
  onRoute: (route: Route) => void
}) {
  const full = useLoad(() => ask('revealFile', { id: props.id }), [props.id])
  const sync = useFileSync()
  const say = useToast()
  const ref = { kind: 'file' as const, id: props.id }
  const { busy: downloading, failed, download } = useDownload(ref)
  const [asking, setAsking] = useState(false)
  const [removing, setRemoving] = useState(false)
  const file: FileFull | undefined = full.value

  if (file === undefined) {
    return full.error !== undefined ? (
      <Message title={t('files_title')} kind="error" onBack={props.onBack}>
        {full.error}
      </Message>
    ) : (
      <div class="screen pad muted" role="status">
        {t('popup_loading')}
      </div>
    )
  }

  const canChange = sync === 'kemlock'
  const shownName = file.fileName ?? file.name
  const remove = async () => {
    setRemoving(true)
    try {
      await ask('deleteFile', { id: file.id })
      props.onBack()
    } catch (error) {
      say(errorMessage(error))
      setRemoving(false)
      setAsking(false)
    }
  }
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(shownName)
      say(t('files_copiedName'))
    } catch {
      say(t('files_copyFailed'))
    }
  }
  const kind = fileKind({ name: shownName, type: file.type })

  return (
    <div class="screen">
      <header class="bar login-bar">
        <IconButton icon="back" label={t('popup_back')} onClick={props.onBack} />
        <KemlockIcon size={24} class="mark" />
        <Tile name={file.name} size={32} />
        <h1 class="login-title">{file.name}</h1>
        {canChange && (
          <>
            <button
              type="button"
              class="link-btn hov"
              onClick={() => props.onRoute({ name: 'fileEdit', id: file.id })}
            >
              {t('popup_edit')}
            </button>
            <IconButton icon="trash" label={t('files_delete')} onClick={() => setAsking(true)} />
          </>
        )}
      </header>
      {asking && (
        <DeleteQuestion
          title={t('files_deleteTitle')}
          body={t('files_deleteBody', file.name)}
          busy={removing}
          onCancel={() => setAsking(false)}
          onConfirm={() => void remove()}
        />
      )}
      <div class="body tight items-page">
        {sync === 'readOnly' && <Notice>{t('files_needSync')}</Notice>}
        <Group>
          <DetailRow label={t('files_labelFile')} value={shownName} mono />
          {kind !== '' && <DetailRow label={t('files_labelType')} value={kind} />}
          {file.size !== undefined && (
            <DetailRow label={t('files_labelSize')} value={fileSize(file.size)} />
          )}
          {file.notes !== '' && <DetailRow label={t('files_labelNotes')} value={file.notes} />}
        </Group>
        <div class="actions start">
          {canChange && (
            <Button
              kind="primary"
              busy={downloading !== undefined}
              disabled={!file.onServer}
              label={t('files_downloadNamed', shownName)}
              onClick={() => void download(undefined, shownName)}
            >
              {downloading !== undefined ? t('files_preparing') : t('files_download')}
            </Button>
          )}
          <Button icon="copy" onClick={() => void copyName()}>
            {t('files_copyName')}
          </Button>
          {canChange && (
            <Button icon="refresh" onClick={() => openFilesTab(`replace/${file.id}`)}>
              {t('files_replace')}
            </Button>
          )}
        </div>
        {canChange && !file.onServer && <p class="strength-line">{t('files_notUploadedYet')}</p>}
        {failed !== undefined && <Notice kind="error">{failed}</Notice>}
        <LinksSection item={ref} onRoute={props.onRoute} onChanged={() => void full.reload()} />
      </div>
    </div>
  )
}
