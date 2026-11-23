// Where the Kemlock app's checkout is, for what the extension takes from it:
// its colours (tokens.mjs), its words (locales.mjs) and its logo
// (icons/render.sh). It is $KEMLOCK_APP when set, and otherwise the
// repository next to this one, ../kemlock. The build never reads it: what the
// zips need is committed here, so a release builds from this repository alone.
// The tests that compare a copy with the app's are skipped when it is missing.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

export const appRoot = resolve(process.env.KEMLOCK_APP ?? join(root, '..', 'kemlock'))
export const appMobile = join(appRoot, 'mobile')
export const hasApp = existsSync(join(appMobile, 'pubspec.yaml'))

/** A path in the app's mobile/ folder, or a clear error when the app isn't checked out. */
export function inApp(...parts) {
  if (!hasApp) {
    throw new Error(
      `The Kemlock app isn't at ${appRoot}: clone it next to this repository, or set KEMLOCK_APP`,
    )
  }
  return join(appMobile, ...parts)
}
