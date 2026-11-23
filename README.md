<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/kemlock-wordmark-dark.svg">
    <img alt="Kemlock" src=".github/assets/kemlock-wordmark-light.svg" width="360">
  </picture>
</p>

<h3 align="center">Kemlock for browsers</h3>

<p align="center">
  Your Kemlock codes and logins in Chrome, Edge and Firefox.
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licence: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="Version 0.1.0" src="https://img.shields.io/badge/version-0.1.0-informational">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-orange">
  <a href="docs/reproducible-builds.md"><img alt="Reproducible builds" src="https://img.shields.io/badge/builds-reproducible-success"></a>
  <br>
  <img alt="Chrome" src="https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-0078D7?logo=microsoftedge&logoColor=white">
  <img alt="Firefox" src="https://img.shields.io/badge/Firefox-supported-FF7139?logo=firefoxbrowser&logoColor=white">
  <img alt="Manifest V3" src="https://img.shields.io/badge/manifest-V3-555555">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white">
  <img alt="Preact" src="https://img.shields.io/badge/Preact-11-673AB8?logo=preact&logoColor=white">
</p>

<p align="center">
  <a href="#building">Building</a> ·
  <a href="docs/reproducible-builds.md">Reproducible builds</a> ·
  <a href="#what-comes-from-the-app">What comes from the app</a> ·
  <a href="https://github.com/Arsslensoft/Kemlock">Kemlock app</a> ·
  <a href="https://github.com/Arsslensoft/Kemlock-Server">Kemlock Server</a>
</p>

---

The Kemlock browser extension fills one-time codes and logins from a Kemlock vault into
websites. It syncs with your own Vaultwarden or WebDAV folder, as the
[phone app](https://github.com/Arsslensoft/Kemlock) does.

- 🔢 **One-time codes and logins** found on a page by the same rules as the Android app,
  held to the same test cases.
- 🔒 **Locks itself** when the browser is idle, and shows in the toolbar whether the vault is
  locked, open, or no longer syncing.
- 🛡️ **Asks for sites one by one.** It holds no access to websites until you grant it.
- 🌍 **English and French**, in the app's own words.
- 📦 **Reproducible zips**: anyone can rebuild a release from its tag and compare the bytes.

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

## Licence

Kemlock for browsers is free software under the
[GNU General Public License v3.0 or later](LICENSE). The Geist fonts in `fonts/` are under the
SIL Open Font License ([fonts/OFL.txt](fonts/OFL.txt)).
