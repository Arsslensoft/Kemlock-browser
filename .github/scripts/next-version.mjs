// The version of the next release, from the Conventional Commits since the last v* tag, for the
// Release workflow (README.md, Releases). Nothing is committed: the version lives in the tag, and
// tool/build.sh takes it from there.
//
//   node .github/scripts/next-version.mjs [--notes FILE]
//
// Prints `release`, `version`, `tag`, `previous` (the tag before, or nothing) and `existing` (the
// commit already carries the tag) to $GITHUB_OUTPUT, or to the terminal when that is not set. A `!`
// after the type, or a BREAKING CHANGE footer, makes a major release (a minor one while the major
// is 0), a feat a minor, and a fix, perf or revert a patch. Docs, chore, test, ci, style, refactor
// and build commits alone make no release. A Revert "..." subject, as git writes it, is a revert.
// GitHub Actions' commits are passed over, Dependabot's are not. With no tag yet, the
// first release is the version package.json holds. A commit that carries a v* tag already is that
// release again (a run that is started over). --notes FILE gets the release's changes, grouped by
// type, as Markdown, for the GitHub release.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const args = process.argv.slice(2)
const notesFile = args.includes('--notes') ? args[args.indexOf('--notes') + 1] : undefined

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim()
const isVersionTag = (tag) => /^v\d+\.\d+\.\d+$/.test(tag)

// The release this commit is already, and the one before it
const tagsAt = git('tag', '--points-at', 'HEAD', '--list', 'v[0-9]*')
const atHead = tagsAt.split('\n').filter(isVersionTag)
const merged = git('tag', '--merged', 'HEAD', '--list', 'v[0-9]*', '--sort=-v:refname')
const previous = merged.split('\n').find((tag) => isVersionTag(tag) && !atHead.includes(tag))

const log = git(
  'log',
  '--no-merges',
  '--format=%H%x1f%ae%x1f%s%x1f%b%x1e',
  previous ? `${previous}..HEAD` : 'HEAD',
)

// The one bot whose commits are passed over: Dependabot's are real changes (a fix of a dependency
// the zips hold is a patch release)
const actionsBot = '41898282+github-actions[bot]@users.noreply.github.com'

/** The commits that count, as { sha, type, scope, breaking, subject }. */
const commits = []
for (const record of log.split('\x1e')) {
  const [sha, email, subject, body = ''] = record.trim().split('\x1f')
  if (!sha || email === actionsBot) continue
  // What `git revert` and GitHub's Revert button write: Revert "feat(popup): ..."
  const reverted = /^Revert "(.+)"$/.exec(subject)
  if (reverted) {
    commits.push({
      sha: sha.slice(0, 7),
      type: 'revert',
      scope: '',
      breaking: false,
      subject: reverted[1],
    })
    continue
  }
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/.exec(subject)
  if (!match) continue
  commits.push({
    sha: sha.slice(0, 7),
    type: match[1].toLowerCase(),
    scope: match[2] ?? '',
    breaking: Boolean(match[3]) || /^BREAKING[ -]CHANGE:/m.test(body),
    subject: match[4],
  })
}

const level = { major: 3, minor: 2, patch: 1 }
let bump
for (const { type, breaking } of commits) {
  let wanted
  if (breaking) wanted = 'major'
  else if (type === 'feat') wanted = 'minor'
  else if (['fix', 'perf', 'revert'].includes(type)) wanted = 'patch'
  if (wanted && (!bump || level[wanted] > level[bump])) bump = wanted
}

let version
if (atHead.length) {
  version = atHead[0].slice(1)
} else if (bump) {
  if (!previous) {
    version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`package.json's version is not x.y.z: ${version}`)
    }
  } else {
    const [major, minor, patch] = previous.slice(1).split('.').map(Number)
    if (bump === 'major' && major === 0) bump = 'minor'
    if (bump === 'major') version = `${major + 1}.0.0`
    else if (bump === 'minor') version = `${major}.${minor + 1}.0`
    else version = `${major}.${minor}.${patch + 1}`
  }
}

const outputs = {
  release: String(Boolean(version)),
  version: version ?? '',
  tag: version ? `v${version}` : '',
  previous: previous ?? '',
  existing: String(atHead.length > 0),
}
for (const [key, value] of Object.entries(outputs)) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  else console.log(`${key}=${value}`)
}
if (!version) {
  console.log('::notice title=Release::No feat, fix, perf or revert commit since the last release')
}

/** The changes, grouped by type, as the Markdown of a release's notes. */
function notes() {
  const groups = [
    ['Breaking changes', (c) => c.breaking],
    ['Features', (c) => !c.breaking && c.type === 'feat'],
    ['Fixes', (c) => !c.breaking && c.type === 'fix'],
    ['Performance', (c) => !c.breaking && c.type === 'perf'],
    ['Reverts', (c) => !c.breaking && c.type === 'revert'],
  ]
  const sections = []
  for (const [title, wanted] of groups) {
    const lines = commits
      .filter(wanted)
      .map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.subject} (${c.sha})`)
    if (lines.length) sections.push(`### ${title}\n\n${lines.join('\n')}`)
  }
  return `${sections.join('\n\n')}\n`
}

if (notesFile && version) writeFileSync(notesFile, notes())
