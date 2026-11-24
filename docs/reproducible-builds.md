# Reproducible builds

The extension is built into one zip per browser, `kemlock-<version>-chrome.zip` (for Chrome
and Edge) and `kemlock-<version>-firefox.zip`. With Docker (or Podman,
`CONTAINER_ENGINE=podman`) installed (the container has Node and the Dart SDK, so neither is needed), from a checkout of this repository:

```bash
tool/build.sh v1.2.0
```

It builds the tag (or `HEAD` when none is given) and prints the SHA-256 of both zips, to
compare with the published ones (`SHA256SUMS` in the release). The release workflow builds the
commit twice, on two runners, with `tool/build.sh --version <x.y.z>`, and tags and publishes it
only if the two are the same bytes. A release is rebuilt with `tool/build.sh v<x.y.z>`, from the
tag: the same bytes as the workflow's build of the commit. Four things make the bytes the same on
any machine:

- **The version is the tag's.** A release commits no version: `manifests/base.json` keeps the
  version the repository started at. For a tag named `v<x.y.z>`, `tool/build.sh` builds with
  `KEMLOCK_VERSION=<x.y.z>`, which `tool/build.mjs` writes into both manifests and so into the
  zips' names. The release workflow gives the same version to the commit it builds before the tag
  exists, with `--version <x.y.z>` (a tag and `--version` that differ are refused). Any other
  commit has the version of `manifests/base.json`.

- **The source is the commit's.** The script takes the commit's files with `git archive`,
  never the working copy, so line endings a checkout converted, or files it holds and the
  commit doesn't, change nothing. Everything the build reads is in this repository, the
  app's fonts included (`fonts/`), so the app's checkout plays no part. The one exception is the
  Dart core's packages, which are fetched and checked against `core/pubspec.lock` (below).
- **The tools and packages are fixed.** It builds in
  [`tool/docker/Containerfile`](../tool/docker/Containerfile): Debian 12, pinned by its image
  digest, with Node 26.13.0 and the Dart SDK 3.13.5 (which compiles `core/` to WebAssembly), each
  checked against its published SHA-256. The npm packages are those `package-lock.json` names, each
  checked by npm against its recorded hash. The Dart packages are those `core/pubspec.lock` names
  (`dart pub get --enforce-lockfile` fails when the lock and `pubspec.yaml` disagree), each with its
  content hash, which pub checks. Kemlock-core, which pub has no hash for, is fetched from GitHub with
  `git` at the full commit id the lock names (`resolved-ref`).
- **The zip holds nothing of the moment.** Its entries are written in path order, each dated
  1 January 1980, with one mode and one compression level.

The first run builds a container of about 440 MB (it has Node, the Dart SDK and `git`). `--here`
builds with the machine's own Node and Dart SDK instead (`dart` on the `PATH`, or `DART_SDK` set; the
script runs `dart pub get --enforce-lockfile` in `core/` itself). It gives the same zips as the
container only with the same Node and Dart versions, 26.13.0 and 3.13.5, so compare a release with
the container's.

The stores add their signatures to what they deliver. Firefox Add-ons adds files under
`META-INF/`, and the Chrome Web Store adds `_metadata/` and wraps the zip in its own format.
Every other file of an installed extension is a file of the zip, and can be compared with
it.
