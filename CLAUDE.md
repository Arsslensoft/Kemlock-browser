# Kemlock for browsers

The Kemlock browser extension: TypeScript, Preact and Vite, built for Chrome (and Edge) and
Firefox from `manifests/`. It moved here, with its history, from `extension/` in the Kemlock
app's repository (`git@github.com:Arsslensoft/Kemlock.git`), which is checked out next to
this one as `../kemlock`.

## Layout

- `src/`: the background worker, the content script and the pages (popup, menu, setup,
  offscreen).
- `tool/`: the build, the zip, and the generators of what comes from the app.
- `manifests/`, `locales/`, `icons/`, `fonts/`: what the build puts in the zips.
- `test/fixtures/`: copies of the app's fixtures. Never edit them here; copy them again
  from the app.
- `docs/`: notes that are part of the repo.

## The app's files

`tool/app.mjs` finds the app's checkout: `$KEMLOCK_APP`, or `../kemlock`. Only the
generators (`npm run tokens`, `npm run locales`, `tool/icons/render.sh`) and the tests that
compare with the app read it; the build reads nothing outside this repository, so a release
builds from it alone. When the app's tokens, strings, logo, fonts or field cases change, run
the generator or copy the file again, and commit that here.

## Checks

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, from the repository
root. On GitHub, `.github/workflows/checks.yml` runs them as the jobs Lint, Test and Build,
with Dependencies, DCO, Licences (`node .github/scripts/check-licences.mjs`) and Security
beside them, and App drift (the tests again, with the app's files; not required). The pull
request's title is checked by `title.yml`. `release.yml` calls `checks.yml` on every push to
`main` and, when it passes, builds the commit twice, tags it and releases the next version from the
Conventional Commits (nothing is committed for a release: the version is the tag's,
`KEMLOCK_VERSION`, see `tool/build.sh`). `codeql.yml` and `scorecard.yml` scan the code and the
workflows. A coding agent never signs off a commit (DCO): leave that to the person.

## Commits

One change at a time, as in the app's repository:
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification),
`type(scope): what the change does`, lowercase after the colon, no trailing period.

- Types: `feat`, `fix`, `test`, `chore`, `docs`, `refactor`, `revert`.
- Scopes: `extension` for the extension as a whole, or the area touched: `background`,
  `content`, `popup`, `menu`, `setup`, `autofill`, `sync`, `i18n`, `theme`, `icons`,
  `build`, `deps`, `lint`.
- A test goes in its own `test(scope)` commit, after the code it checks, unless it is a
  fix's regression test.
- Lockfile and dependency changes go in with the feature that needs them, or in their own
  `chore(deps)` commit.
- The body, wrapped at about 72 columns, says what was wrong or missing and why the change
  fixes it.
- AI agents end the message with an `Assisted-by: <model> via <tool>` footer, e.g.
  `Assisted-by: Claude Opus 5.5 via Claude Code`, and no `Co-Authored-By` line.
