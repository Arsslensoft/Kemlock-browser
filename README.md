# Kemlock for browsers

The Kemlock browser extension, for Chrome, Edge and Firefox. It fills one-time codes and
logins from a Kemlock vault into websites. The phone app is in the
[Kemlock](https://github.com/Arsslensoft/Kemlock) repository.

## Building

```bash
npm ci
npm run build       # dist/chrome and dist/firefox
npm test
npm run lint
npm run typecheck
```

`tool/build.sh` builds the release zips from a commit, the same bytes on any machine: see
[docs/reproducible-builds.md](docs/reproducible-builds.md).

## What comes from the app

The extension looks like the app and speaks its words, so some of its files are made from
the app's. A checkout of the app next to this one (`../kemlock`, or the path in
`KEMLOCK_APP`) is needed to make them again, never to build:

- `src/shared/tokens.css`, from `mobile/lib/ui/theme/tokens.dart`: `npm run tokens`.
- `locales/app/`, from `mobile/assets/i18n`: `npm run locales`.
- `icons/kemlock-*.png`, from `mobile/assets/brand`: `tool/icons/render.sh`.
- `fonts/`, a copy of `mobile/assets/fonts` (Geist, under the SIL Open Font License).
- `test/fixtures/autofill/fields.json`, a copy of the app's field cases, which the
  extension's field finder and the Android app's are both held to.

When the app's checkout is there, the tests check that each of these still matches it. Without
it, those tests are skipped.
