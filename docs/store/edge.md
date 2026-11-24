# Edge Add-ons listing

The same zip as Chrome's (`kemlock-<version>-chrome.zip`), the same texts and screenshots. Only what
differs is here; the rest is [chrome.md](chrome.md): the name, the summary, both descriptions, the
privacy answers and the permission justifications.

## Partner Center, Properties

- **Category**: Productivity.
- **Privacy policy URL**: https://github.com/Arsslensoft/Kemlock-browser#what-the-extension-keeps-and-where-it-goes
- **Website URL**: https://github.com/Arsslensoft/Kemlock-browser
- **Support contact**: https://github.com/Arsslensoft/Kemlock-browser/issues
- **Does the extension access, collect or transmit personal information?** It handles the person's own
  passwords and codes inside their browser, and sends them only to the sync server the person
  configures. Nothing goes to the developer. Answer as chrome.md's "Data usage" does.
- **Mature content**: no.

## Store listing

- **Description**: chrome.md's, English, then French.
- **Screenshots**: chrome.md's five, 1280×800 (Edge accepts up to 10).
- **Small tile** (300×300), logo (128×128, `icons/kemlock-128.png`): the extension's own icon.
- **Search terms** (up to 7): one-time codes, 2FA, TOTP, authenticator, password manager,
  autofill, Kemlock.

## Notes for certification

```
This is the same package as the Chrome Web Store's. Edge 119 or later (Chromium 119).
It needs a sync place to be useful: a WebDAV folder, a Vaultwarden or a Kemlock Server. For this
review use the WebDAV folder below: <address, username, password, passphrase>.
No account with us is needed. The menu in pages is an extension page in a frame (web_accessible_resources),
at an address that changes each browser session.
Source and build: https://github.com/Arsslensoft/Kemlock-browser, tag v<version>, docs/reproducible-builds.md.
```

## Single sign-on

Kemlock Server allows SSO from the extension ids in its `KEMLOCK_BROWSER_EXTENSION_IDS` setting.
Edge's id is the one in the Edge Add-ons address (`microsoftedge.microsoft.com/addons/detail/<name>/<id>`),
and `edge://extensions` shows it under Developer mode. It is not Chrome's: a self-hoster who wants SSO
from Edge adds both.

## Submitting

1. The zip, its SHA-256 checked against `SHA256SUMS`.
2. Availability: public, all markets. Edge 119 is the minimum (`minimum_chrome_version`).
3. The release workflow has a job for Edge Add-ons (`EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`,
   `EDGE_API_KEY`), off until `PUBLISH_STORES` is `true`. The first version is submitted by hand here.
