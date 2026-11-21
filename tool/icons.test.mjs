import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const icons = join(root, 'icons')
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('icons', () => {
  it('are whole PNGs of the size their names say', async () => {
    const files = (await readdir(icons)).filter((file) => file.endsWith('.png'))
    expect(files.length).toBe(13)
    for (const file of files) {
      const png = await readFile(join(icons, file))
      expect(png.subarray(0, 8).equals(signature), `${file}'s signature`).toBe(true)
      expect(png.subarray(12, 16).toString('latin1'), file).toBe('IHDR')
      const size = Number(/-(\d+)\.png$/.exec(file)[1])
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([size, size])
    }
  })

  it('come for each toolbar state at 16, 24 and 32 pixels, and for the store at 128', async () => {
    const files = await readdir(icons)
    for (const state of ['locked', 'unlocked', 'sync-stopped'])
      for (const size of [16, 24, 32]) expect(files).toContain(`${state}-${size}.png`)
    for (const size of [16, 32, 48, 128]) expect(files).toContain(`kemlock-${size}.png`)
  })

  it("draw the keyhole K of the app's brand.svg", async () => {
    const brand = await readFile(join(root, '..', 'mobile', 'tool', 'icons', 'brand.svg'), 'utf8')
    const shapes = [...brand.matchAll(/ d="([^"]+)"/g)].map((m) => m[1])
    expect(shapes).toHaveLength(2)
    for (const state of ['locked', 'unlocked', 'sync-stopped']) {
      const svg = await readFile(join(root, 'tool', 'icons', `${state}.svg`), 'utf8')
      for (const d of shapes) expect(svg, state).toContain(`d="${d}"`)
    }
  })

  it('are the ones the manifest names', async () => {
    const base = JSON.parse(await readFile(join(root, 'manifests', 'base.json'), 'utf8'))
    const named = [...Object.values(base.icons), ...Object.values(base.action.default_icon)]
    expect(named).toContain('icons/locked-16.png')
    const files = await readdir(icons)
    for (const path of named) expect(files).toContain(path.replace(/^icons\//, ''))
  })
})
