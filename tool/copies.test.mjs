import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appMobile, hasApp } from './app.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// What the extension keeps a copy of so it builds and tests without the
// app's checkout, by the app's path for it.
const copies = [
  { ours: 'fonts', app: join('assets', 'fonts') },
  { ours: join('test', 'fixtures', 'autofill'), app: join('test', 'fixtures', 'autofill') },
]

describe.skipIf(!hasApp)("the copies of the app's files", () => {
  for (const { ours, app } of copies) {
    it(`${ours} holds the app's mobile/${app.replace(/\\/g, '/')}, byte for byte`, async () => {
      for (const file of await readdir(join(root, ours))) {
        const mine = await readFile(join(root, ours, file))
        const theirs = await readFile(join(appMobile, app, file))
        expect(mine.equals(theirs), `${ours}/${file}: copy it again from the app`).toBe(true)
      }
    })
  }
})
