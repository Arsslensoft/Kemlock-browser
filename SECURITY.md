# Security policy

## Reporting a vulnerability

Report a security problem privately, not in a public issue: use
[Report a vulnerability](https://github.com/Arsslensoft/Kemlock-browser/security/advisories/new) on
this repository's Security tab. The report stays between you and the maintainers until a fixed
release is out, and the advisory is published with it. Please keep the details to yourself until
then.

Say as much as you can of:

- the browser and its version, and the extension's version,
- what an attacker gains, and from where: a website, another extension, the server the vault syncs
  with, the network, or someone at the unlocked computer,
- the steps that show it.

## Scope

This repository holds the browser extension. A report belongs here when the problem is in something
it makes or does:

- the extension's code: how it finds codes and logins on a page and fills them, how it holds the
  vault while it is open and locks it, and how it talks to the server,
- the permissions and the content security policy in `manifests/`, and a site getting at the
  extension's pages or the vault without the person's grant,
- a way to run code that is not in the zip, or to get a secret, a code or a password out of the
  browser,
- how the zips are built and released (`tool/`, `.github/workflows/`): a release that cannot be
  rebuilt from its tag (docs/reproducible-builds.md), or a workflow that leaks a secret.

A problem in the browser, in the Kemlock app or in Kemlock Server belongs to that project. The
app's and the server's repositories are private for now, so report it here and it will be passed
on. The vault's encryption is the app's and the server's. When it is not clear which it is, report
it here.

## Supported versions

Fixes go into a new release; an older release is not patched. The extension is not in the browsers'
stores yet, and a browser updates an extension only from its store, so for now an update is a new
zip on the [Releases](https://github.com/Arsslensoft/Kemlock-browser/releases) page, installed by
hand. Once the stores list it, they update it by themselves.
