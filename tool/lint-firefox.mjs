// `web-ext lint` over dist/firefox, failing on any error, notice or
// warning but one: Preact's renderer assigns innerHTML for
// dangerouslySetInnerHTML, which our own code may not use (eslint.config.js
// forbids it).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'dist/firefox'
const out = execFileSync(
  process.execPath,
  ['node_modules/web-ext/bin/web-ext.js', 'lint', '--source-dir', dir, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
)
const report = JSON.parse(out)

/** Preact's own `dom.innerHTML = props.dangerouslySetInnerHTML.__html`. */
function isPreactInnerHtml(message) {
  if (message.code !== 'UNSAFE_VAR_ASSIGNMENT' || !message.file) return false
  const line = readFileSync(join(dir, message.file), 'utf8').split('\n')[message.line - 1] ?? ''
  const assignments = [...line.matchAll(/\.innerHTML\s*=(?!=)/g)]
  if (assignments.length !== 1) return false
  const near = line.slice(Math.max(0, (message.column ?? 0) - 60), (message.column ?? 0) + 60)
  return /\.innerHTML=[\w$]+\.__html/.test(near)
}

const problems = [
  ...report.errors,
  ...report.notices,
  ...report.warnings.filter((m) => !isPreactInnerHtml(m)),
]
for (const m of problems) console.error(`${m.code} ${m.file ?? ''}:${m.line ?? ''} ${m.message}`)
if (problems.length) process.exit(1)
console.log(`web-ext lint: ${dir} is clean but for Preact's innerHTML`)
