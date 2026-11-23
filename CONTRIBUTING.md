# Contributing

Thanks for helping out!

This repository holds the Kemlock extension for Chrome, Edge and Firefox. Open an issue or a pull
request on [Arsslensoft/Kemlock-browser](https://github.com/Arsslensoft/Kemlock-browser). By taking
part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). A security problem is not an issue: see
[SECURITY.md](SECURITY.md).

The extension looks like the Kemlock app and speaks its words, so some files are made from the
app's (README.md, What comes from the app). Change those in the app, then copy or generate them
again here.

Set up with `npm ci`. Node 26.13.0 is what the release builds with.

## Pull requests

The `main` ruleset requires a pull request, with no approvals needed, the checks below, and every
conversation resolved. CodeRabbit reviews each pull request, and the maintainer merges it; the
maintainer can bypass the ruleset. The required checks are these jobs, under the names GitHub
shows:

- **Lint**: `npm run lint` (eslint, then Prettier's check; `npm run format` fixes the formatting),
  `npm run typecheck`, ShellCheck on the shell files you changed, and actionlint on the workflows.
- **Test**: `npm test`. Some tests compare the extension's copies with the app's files. They need a
  checkout of the app next to this one (`../kemlock`) or in `KEMLOCK_APP`, and skip themselves
  without it, as they do in this job. A separate job, **App drift**, runs the whole suite with the
  app's files when the repository can read them. It is not required and a release does not wait for
  it: it says that the app has moved on from the copies, or that a copy was edited here.
- **Build**: `npm run build`, then `npm run lint:firefox` (web-ext's lint over `dist/firefox`).
- **Title** (its own workflow, `title.yml`): the title is a Conventional Commit
  (`fix(popup): ...`), since it becomes the commit's subject when the pull request is squashed,
  and a `feat` or a `fix` becomes a line of the release's notes. Write it in plain words.
- **Dependencies**: nothing the change adds has a known serious vulnerability or a licence that
  GPL-3.0-or-later cannot take in.
- **DCO**: every commit is signed off (below). `bash .github/scripts/check-dco.sh origin/main HEAD`
  runs it on your machine.
- **Licences**: every package in `package-lock.json`, the tools that build the zips as well as what
  the zips hold, is under a licence on the list in `.github/scripts/check-licences.mjs`, and the
  fonts come with their licence. `node .github/scripts/check-licences.mjs` runs it on your machine.
  A package that declares no licence or an odd one is named in `.github/licence-exceptions.json`,
  with its licence and why, once a person has read it.
- **Security**: the change adds no workflow risk that `zizmor` finds and `main` does not have, no
  secret in its commits (`gitleaks`; a made-up one in a test is fine, elsewhere mark its line with
  `gitleaks:allow`), and, when it changes `package-lock.json`, no package that the zips hold with a
  known advisory (`npm audit --omit=dev --audit-level=high`).

CodeRabbit reviews every push. Answer or fix each of its comments and resolve the thread; its
checks (the licences and credits, a test with every change of behaviour, the security defaults,
the documentation kept accurate) are open until they are settled. CodeQL scans the code and the
workflows.

A new permission or host permission in `manifests/`, remote code, `eval`, `innerHTML`, or anything
that leaves the browser for somewhere other than the person's own server needs its reason in the
pull request.

### Signing off (DCO)

Each commit carries a `Signed-off-by:` line with your name and the address you commit with, by
which you certify the [Developer Certificate of Origin](https://developercertificate.org): that you
wrote the change, or otherwise have the right to submit it under the project's licence.
`git commit -s` adds it; for commits made already, `git rebase --signoff origin/main` and push
again. Only a person can certify it: a coding agent never signs off for you, so sign off its
commits yourself once you have read them. A bot's commits (Dependabot's) are passed over.

## Commits

One change at a time, as [CLAUDE.md](CLAUDE.md) says: Conventional Commits,
`type(scope): what the change does`, lowercase after the colon, no trailing period, a body that
says what was wrong and why the change fixes it, and a test in its own commit or with its fix.
End the message with `Assisted-by: <model> via <tool>` when an AI agent helped.

## Releases

Nobody makes a release by hand. A push to main that holds a `feat`, a `fix`, a `perf` or a `revert`
commit since the last tag is built twice, and if the two builds are the same bytes, tagged and
released as the next version, which the commit types decide (README.md, Releases). Nothing is
committed for it: the version is the tag's.

## Dependencies

Dependabot proposes updates every week. It turns on auto-merge for a patch update of any
dependency, and for a minor update of a development dependency or of a GitHub Action; they merge
once the required checks pass. A major update, and a minor one of a package the zips hold, wait
for a person. An update of a package the zips hold is titled `fix(deps): ...`, so it makes a
patch release; one of a development tool or an Action is `chore`, and makes none.

Dependabot cannot bump the Node tarball and its SHA-256 in `tool/docker/Containerfile`, nor its
Debian image. Bump them by hand, in one pull request, with the Node version in the workflows'
`node-version`, `tool/build.sh` and `docs/reproducible-builds.md`.
