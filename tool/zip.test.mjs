import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { zip, zipFolder } from './zip.mjs'

/** The entries of a zip, read from its central directory as an unzip tool reads them. */
function entries(archive) {
  const end = archive.length - 22
  expect(archive.readUInt32LE(end)).toBe(0x06054b50)
  const count = archive.readUInt16LE(end + 10)
  let at = archive.readUInt32LE(end + 16)
  const out = []
  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50)
    const nameLength = archive.readUInt16LE(at + 28)
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const local = archive.readUInt32LE(at + 42)
    const packedLength = archive.readUInt32LE(at + 20)
    const dataAt = local + 30 + archive.readUInt16LE(local + 26)
    const data = inflateRawSync(archive.subarray(dataAt, dataAt + packedLength))
    out.push({
      name,
      data,
      crc: archive.readUInt32LE(at + 16),
      time: archive.readUInt16LE(at + 12),
      date: archive.readUInt16LE(at + 14),
      mode: archive.readUInt32LE(at + 38) >>> 16,
      utf8: (archive.readUInt16LE(at + 8) & 0x0800) !== 0,
    })
    at += 46 + nameLength
  }
  return out
}

const dirs = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function folder(files) {
  const dir = await mkdtemp(join(tmpdir(), 'kemlock-zip-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), text)
  }
  return dir
}

describe('zipFolder', () => {
  const files = {
    'manifest.json': '{"name":"Kemlock"}\n',
    'src/popup/index.html': '<!doctype html>',
    'assets/b.js': 'b'.repeat(5000),
    'assets/a.js': 'export {}',
    '_locales/fr/messages.json': '{"extName":{"message":"Kemlock — à vous"}}',
  }

  it('gives the same bytes for the same files, whatever their dates', async () => {
    const one = await folder(files)
    const two = await folder(files)
    await utimes(join(two, 'manifest.json'), new Date('2031-05-06'), new Date('2031-05-06'))
    expect((await zipFolder(one)).equals(await zipFolder(two))).toBe(true)
  })

  it('holds every file whole, by its path, in byte order', async () => {
    const read = entries(await zipFolder(await folder(files)))
    expect(read.map((e) => e.name)).toEqual([
      '_locales/fr/messages.json',
      'assets/a.js',
      'assets/b.js',
      'manifest.json',
      'src/popup/index.html',
    ])
    for (const entry of read) {
      expect(entry.data.toString('utf8'), entry.name).toBe(files[entry.name])
      expect(entry.crc, entry.name).toBe(crc32(entry.data))
    }
  })

  it('dates every entry 1980-01-01 and gives each the same mode', async () => {
    for (const entry of entries(await zipFolder(await folder(files)))) {
      expect([entry.date, entry.time, entry.mode, entry.utf8]).toEqual([0x21, 0, 0o100644, true])
    }
  })
})

describe('zip', () => {
  it('takes the files in the order given and names them in UTF-8', () => {
    const read = entries(
      zip([
        { name: 'é/b.txt', data: Buffer.from('b') },
        { name: 'a.txt', data: Buffer.from('') },
      ]),
    )
    expect(read.map((e) => [e.name, e.data.toString()])).toEqual([
      ['é/b.txt', 'b'],
      ['a.txt', ''],
    ])
  })
})
