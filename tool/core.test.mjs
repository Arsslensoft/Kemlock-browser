import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dartCompileArgs, dartVersion } from './build.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

describe('the core build', () => {
  it('compiles the entry to WebAssembly, once, at the optimisation the release uses', () => {
    expect(dartCompileArgs('/out/core.wasm')).toEqual([
      'compile',
      'wasm',
      '-O2',
      '-o',
      '/out/core.wasm',
      'lib/main.dart',
    ])
  })

  it('uses the Dart SDK the pubspec and the Containerfile name', async () => {
    expect(await readFile(join(root, 'core', 'pubspec.yaml'), 'utf8')).toContain(
      `sdk: ^${dartVersion}`,
    )
    expect(await readFile(join(root, 'tool', 'docker', 'Containerfile'), 'utf8')).toContain(
      `release/${dartVersion}/sdk/dartsdk-linux-x64-release.zip`,
    )
  })

  it('pins Kemlock-core to a commit in the lock, as a release builds it', async () => {
    const lock = await readFile(join(root, 'core', 'pubspec.lock'), 'utf8')
    expect(lock).toMatch(/kemlock_core:[\s\S]*?resolved-ref: "[0-9a-f]{40}"[\s\S]*?source: git/)
  })
})
