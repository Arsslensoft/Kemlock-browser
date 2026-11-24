// A tiny QR code encoder for the fixture page that shows an otpauth link: byte mode, error
// correction level M, versions 1 to 10 (up to 213 bytes), after the algorithm of ISO/IEC 18004
// as Project Nayuki's public QR generator lays it out. No dependency. The pages draw the matrix on
// a canvas, which the extension's "Add a code" captures from the tab and decodes.
;(function () {
  'use strict'

  // Error correction codewords per block, and blocks, at level M, for versions 1 to 10
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
  const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
  const MAX_VERSION = 10

  function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2
      result -= (25 * numAlign - 10) * numAlign - 55
      if (ver >= 7) result -= 36
    }
    return result
  }

  const dataCodewords = (ver) =>
    Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]

  function gfMultiply(x, y) {
    let z = 0
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d)
      z ^= ((y >>> i) & 1) * x
    }
    return z
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0)
    result[degree - 1] = 1
    let root = 1
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root)
        if (j + 1 < degree) result[j] ^= result[j + 1]
      }
      root = gfMultiply(root, 0x02)
    }
    return result
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0)
    for (const b of data) {
      const factor = b ^ result.shift()
      result.push(0)
      divisor.forEach((coef, i) => {
        result[i] ^= gfMultiply(coef, factor)
      })
    }
    return result
  }

  const bit = (x, i) => ((x >>> i) & 1) !== 0

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text))
    // The smallest version that holds the text
    let ver = 1
    for (; ver <= MAX_VERSION; ver++) {
      const countBits = ver < 10 ? 8 : 16
      if (4 + countBits + bytes.length * 8 <= dataCodewords(ver) * 8) break
    }
    if (ver > MAX_VERSION) throw new Error('The text is too long for this encoder')

    // The data bits
    const bits = []
    const put = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
    }
    put(0b0100, 4)
    put(bytes.length, ver < 10 ? 8 : 16)
    for (const b of bytes) put(b, 8)
    const capacityBits = dataCodewords(ver) * 8
    put(0, Math.min(4, capacityBits - bits.length))
    put(0, (8 - (bits.length % 8)) % 8)
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) put(pad, 8)
    const data = []
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
      data.push(b)
    }

    // Error correction, interleaved
    const numBlocks = BLOCKS[ver]
    const eccLen = ECC_PER_BLOCK[ver]
    const rawCodewords = Math.floor(rawDataModules(ver) / 8)
    const numShort = numBlocks - (rawCodewords % numBlocks)
    const shortLen = Math.floor(rawCodewords / numBlocks)
    const divisor = rsDivisor(eccLen)
    const blocks = []
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
      k += dat.length
      const ecc = rsRemainder(dat, divisor)
      if (i < numShort) dat.push(0)
      blocks.push(dat.concat(ecc))
    }
    const codewords = []
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortLen - eccLen || j >= numShort) codewords.push(block[i])
      })
    }

    // The matrix
    const size = ver * 4 + 17
    const modules = Array.from({ length: size }, () => new Array(size).fill(false))
    const isFunction = Array.from({ length: size }, () => new Array(size).fill(false))
    const setFunction = (x, y, dark) => {
      modules[y][x] = dark
      isFunction[y][x] = true
    }

    const drawFormat = (mask) => {
      const dataBits = (0 << 3) | mask // level M is 00
      let rem = dataBits
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
      const fmt = ((dataBits << 10) | rem) ^ 0x5412
      for (let i = 0; i <= 5; i++) setFunction(8, i, bit(fmt, i))
      setFunction(8, 7, bit(fmt, 6))
      setFunction(8, 8, bit(fmt, 7))
      setFunction(7, 8, bit(fmt, 8))
      for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(fmt, i))
      for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(fmt, i))
      for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(fmt, i))
      setFunction(8, size - 8, true)
    }

    for (let i = 0; i < size; i++) {
      setFunction(6, i, i % 2 === 0)
      setFunction(i, 6, i % 2 === 0)
    }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy))
          const x = cx + dx
          const y = cy + dy
          if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, dist !== 2 && dist !== 4)
        }
      }
    }
    finder(3, 3)
    finder(size - 4, 3)
    finder(3, size - 4)
    const positions = []
    if (ver > 1) {
      const numAlign = Math.floor(ver / 7) + 2
      const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
      positions.push(6)
      for (let pos = size - 7; positions.length < numAlign; pos -= step) positions.splice(1, 0, pos)
    }
    positions.forEach((px, i) => {
      positions.forEach((py, j) => {
        const corner =
          (i === 0 && j === 0) ||
          (i === 0 && j === positions.length - 1) ||
          (i === positions.length - 1 && j === 0)
        if (corner) return
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
          }
        }
      })
    })
    drawFormat(0)
    if (ver >= 7) {
      let rem = ver
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
      const verBits = (ver << 12) | rem
      for (let i = 0; i < 18; i++) {
        const dark = bit(verBits, i)
        const a = size - 11 + (i % 3)
        const b = Math.floor(i / 3)
        setFunction(a, b, dark)
        setFunction(b, a, dark)
      }
    }

    // The codewords, in the zigzag of two columns
    let n = 0
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? size - 1 - vert : vert
          if (!isFunction[y][x] && n < codewords.length * 8) {
            modules[y][x] = bit(codewords[n >>> 3], 7 - (n & 7))
            n++
          }
        }
      }
    }

    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const invert = [
            (x + y) % 2 === 0,
            y % 2 === 0,
            x % 3 === 0,
            (x + y) % 3 === 0,
            (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
            ((x * y) % 2) + ((x * y) % 3) === 0,
            (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
            (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
          ][mask]
          if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x]
        }
      }
    }

    const penalty = () => {
      let score = 0
      const lines = []
      for (let i = 0; i < size; i++) {
        lines.push(modules[i])
        lines.push(modules.map((row) => row[i]))
      }
      for (const line of lines) {
        let run = 1
        for (let i = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++
          else {
            if (run >= 5) score += 3 + (run - 5)
            run = 1
          }
        }
        const text = line.map((d) => (d ? '1' : '0')).join('')
        for (const pattern of ['10111010000', '00001011101']) {
          for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1))
            score += 40
        }
      }
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = modules[y][x]
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1])
            score += 3
        }
      }
      const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
      const total = size * size
      score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
      return score
    }

    let best = 0
    let bestScore = Infinity
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask)
      drawFormat(mask)
      const score = penalty()
      if (score < bestScore) {
        best = mask
        bestScore = score
      }
      applyMask(mask)
    }
    applyMask(best)
    drawFormat(best)
    return modules
  }

  // Draws the code on a canvas: `scale` pixels a module, a four-module white border
  function draw(canvas, text, scale) {
    const modules = encode(text)
    const border = 4
    const side = (modules.length + border * 2) * scale
    canvas.width = side
    canvas.height = side
    const g = canvas.getContext('2d')
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, side, side)
    g.fillStyle = '#000000'
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) g.fillRect((x + border) * scale, (y + border) * scale, scale, scale)
      }),
    )
  }

  const api = { encode, draw }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else globalThis.kemlockQr = api
})()
