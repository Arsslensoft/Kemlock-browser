// Writes src/shared/tokens.css from the app's mobile/lib/ui/theme/tokens.dart
// (the app's checkout is found by tool/app.mjs)
// for design decision 3: every colour of AppPalette and BmcTokens as a custom
// property, light by default and dark when the system is. Run it after
// changing tokens.dart; tool/tokens.test.mjs fails until it is.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appMobile, inApp } from './app.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const tokensDart = join(appMobile, 'lib', 'ui', 'theme', 'tokens.dart')
export const tokensCss = join(root, 'src', 'shared', 'tokens.css')

const kebab = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

const rgba = (r, g, b, a) => `rgba(${r}, ${g}, ${b}, ${a})`

/** A Dart colour as CSS: Color(0xAARRGGBB) or Color.fromRGBO(r, g, b, opacity). */
function cssColor(value, grounds) {
  let m = /^Color\(0x([0-9A-Fa-f]{8})\)$/.exec(value)
  if (m) {
    const [a, r, g, b] = [0, 2, 4, 6].map((i) => parseInt(m[1].slice(i, i + 2), 16))
    // Lower case, as Prettier writes CSS
    if (a === 255) return `#${m[1].slice(2).toLowerCase()}`
    return rgba(r, g, b, Math.round((a / 255) * 1000) / 1000)
  }
  m = /^Color\.fromRGBO\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value)
  if (m) return rgba(m[1], m[2], m[3], Number(m[4]))
  m = /^Ground\.(dark|light)$/.exec(value)
  if (m && grounds[m[1]]) return grounds[m[1]]
  return null
}

/** A one-shadow list as CSS: [BoxShadow(color: …, offset: Offset(x, y), blurRadius: b)]. */
function cssShadow(value, grounds) {
  const m =
    /^\[BoxShadow\(color: (.+), offset: Offset\((-?[\d.]+), (-?[\d.]+)\), blurRadius: ([\d.]+)\)\]$/.exec(
      value,
    )
  if (!m) return null
  const color = cssColor(m[1], grounds)
  const px = (n) => (Number(n) === 0 ? '0' : `${n}px`)
  return color && `${px(m[2])} ${px(m[3])} ${px(m[4])} ${color}`
}

/** The fields of `static const <scheme> = <Class>(…);`, in order. */
function fields(source, className, scheme, grounds) {
  const start = source.indexOf(`static const ${scheme} = ${className}(`)
  if (start < 0) throw new Error(`tokens.dart has no ${className}.${scheme}`)
  const body = source.slice(start, source.indexOf('\n  );', start))
  const out = []
  for (const line of body.split('\n').slice(1)) {
    const text = line.trim()
    if (text === '' || text.startsWith('//')) continue
    const m = /^(\w+): (.+),$/.exec(text)
    if (!m) throw new Error(`Can't read "${text}" in ${className}.${scheme}`)
    const [, name, value] = m
    if (name === 'brightness') continue
    const css = cssColor(value, grounds) ?? cssShadow(value, grounds)
    if (css === null)
      throw new Error(`Can't turn ${className}.${scheme}.${name} (${value}) into CSS`)
    out.push([kebab(name), css])
  }
  return out
}

/** tokens.css for a tokens.dart. */
export function tokensToCss(source) {
  const ground = (scheme) => {
    const m = new RegExp(`static const ${scheme} = (Color\\(0x[0-9A-Fa-f]{8}\\));`).exec(source)
    if (!m) throw new Error(`tokens.dart has no Ground.${scheme}`)
    return cssColor(m[1], {})
  }
  const grounds = { dark: ground('dark'), light: ground('light') }
  const scheme = (name) => {
    const all = [
      ['ground', grounds[name]],
      ...fields(source, 'AppPalette', name, grounds),
      ...fields(source, 'BmcTokens', name, grounds),
    ]
    const seen = new Set()
    for (const [prop] of all) {
      if (seen.has(prop)) throw new Error(`Two tokens are called --${prop}`)
      seen.add(prop)
    }
    return all.map(([prop, css]) => `  --${prop}: ${css};`).join('\n')
  }
  return [
    '/* Written by tool/tokens.mjs from mobile/lib/ui/theme/tokens.dart.',
    '   Run `npm run tokens` after changing that file; never edit this one. */',
    '',
    ':root {',
    '  color-scheme: light dark;',
    scheme('light'),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    scheme('dark').replace(/^ {2}/gm, '    '),
    '  }',
    '}',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  inApp()
  await writeFile(tokensCss, tokensToCss(await readFile(tokensDart, 'utf8')))
  console.log('src/shared/tokens.css')
}
