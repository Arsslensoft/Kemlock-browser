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
})
