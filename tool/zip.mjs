// Zips each browser's build in dist/ (Chrome's, Firefox's and Safari's) as kemlock-<version>-<browser>.zip, the
// same bytes for the same files (design decision 18): entries in path
// order, every date 1980-01-01, one mode and one compression level, and
// nothing of the machine. `node tool/zip.mjs <dist> <out>`.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

/** The builds that are zipped, one folder of dist/ each. */
export const browsers = ['chrome', 'firefox', 'safari']

/** 1980-01-01 00:00, the earliest time a zip can hold. */
const dosDate = (0 << 9) | (1 << 5) | 1
const dosTime = 0
/** Made on Unix, so the mode below is read: a plain file, rw-r--r--. */
const madeBy = (3 << 8) | 20
const fileMode = 0o100644
/** Names are UTF-8. */
const utf8Flag = 0x0800

/** Every file under [dir], as forward-slash paths in byte order. */
async function filesUnder(dir) {
  const out = []
  async function walk(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) out.push(relative(dir, path).split(sep).join('/'))
      else throw new Error(`Not a file or folder: ${path}`)
    }
  }
  await walk(dir)
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
}

/** A zip of [files], each `{ name, data }`, in the order given. */
export function zip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const packed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(utf8Flag, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBytes, packed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(madeBy, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(utf8Flag, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE((fileMode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** Zips the folder [dir], every file under it by its path. */
export async function zipFolder(dir) {
  const files = []
  for (const name of await filesUnder(dir))
    files.push({ name, data: await readFile(join(dir, name)) })
  return zip(files)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dist, out] = process.argv.slice(2)
  for (const browser of browsers) {
    const dir = join(dist, browser)
    const { version } = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
    const file = join(out, `kemlock-${version}-${browser}.zip`)
    await writeFile(file, await zipFolder(dir))
    console.log(file)
  }
}
