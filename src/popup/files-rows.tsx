// Files on Home: the rows of the Files tab and of a search, and the panel they sit in. A file's bytes are never listed: a row says its
// name, its kind and its size, and a click opens the file's page.
import type { FileSync, FileView } from '../shared/api'
import { Button, Notice, Tile } from '../shared/ui/components'
import { t } from '../shared/ui/i18n'
import { Icon } from '../shared/ui/icons'
import { fileDetail, openFilesTab } from './file-actions'
import type { Route } from './route'

function FileRow(props: { file: FileView; onOpen: (id: string) => void }) {
  const { file } = props
  const line = [
    fileDetail({ name: file.fileName ?? file.name, type: file.type, size: file.size }),
    file.onServer ? '' : t('files_notUploaded'),
  ]
    .filter((part) => part !== '')
    .join(' · ')
  return (
    <li class="item">
      <button
        type="button"
        class="item-main hov"
        aria-label={t('files_open', file.name)}
        onClick={() => props.onOpen(file.id)}
      >
        <Tile name={file.name} />
        <span class="grow lines">
          <span class="name ellipsis">{file.name}</span>
          {line !== '' && <span class="label ellipsis">{line}</span>}
        </span>
        {file.pinned && (
          <span class="value">
            <span class="mono sub">{t('items_pinned')}</span>
          </span>
        )}
      </button>
    </li>
  )
}

/**
 * The Files panel: its rows (already searched and put in order), a New file button where files can be added, and what is said where
 * they cannot. [total] is how many files the vault holds, to tell an empty vault from an empty search or tag.
 */
export function FilesPanel(props: {
  files: FileView[]
  total: number
  sync: FileSync | undefined
  searching: boolean
  onRoute: (route: Route) => void
}) {
  const { files, total, sync, searching } = props
  const canAdd = sync === 'kemlock'
  const open = (id: string) => props.onRoute({ name: 'file', id })
  const sentence = t('files_none')
  const cut = sentence.indexOf('. ') + 1
  return (
    <div
      class="panel"
      role={searching ? undefined : 'tabpanel'}
      id="panel-files"
      aria-labelledby={searching ? undefined : 'tab-files'}
    >
      {searching && <h2 class="label-caps list-title">{t('files_tab')}</h2>}
      {!searching && sync === 'readOnly' && (
        <div class="home-notice">
          <Notice>{t('files_needSync')}</Notice>
        </div>
      )}
      {!searching && canAdd && total > 0 && (
        <div class="items-head">
          <Button kind="ghost" icon="plus" onClick={() => openFilesTab('newFile')}>
            {t('files_new')}
          </Button>
        </div>
      )}
      {files.length > 0 ? (
        <ul class="list">
          {files.map((file) => (
            <FileRow key={file.id} file={file} onOpen={open} />
          ))}
        </ul>
      ) : (
        !searching &&
        (total === 0 ? (
          <div class="empty-state">
            <span class="empty-icon" aria-hidden="true">
              <Icon name="folder" size={30} weight={1.6} />
            </span>
            <div class="empty-words">
              <p class="empty-title">{cut > 0 ? sentence.slice(0, cut) : sentence}</p>
              {cut > 0 && <p class="empty-rest">{sentence.slice(cut + 1)}</p>}
            </div>
            {canAdd && (
              <Button icon="plus" onClick={() => openFilesTab('newFile')}>
                {t('files_new')}
              </Button>
            )}
          </div>
        ) : (
          <p class="empty muted">{t('popup_noneInTag')}</p>
        ))
      )}
    </div>
  )
}
