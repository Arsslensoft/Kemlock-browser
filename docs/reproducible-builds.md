# Reproducible builds

The extension is built into one zip per browser, `kemlock-<version>-chrome.zip` (for Chrome
and Edge) and `kemlock-<version>-firefox.zip`. With Docker (or Podman,
`CONTAINER_ENGINE=podman`) installed, from a checkout of this repository:

```bash
tool/build.sh v1.2.0
```

It builds the tag (or `HEAD` when none is given) and prints the SHA-256 of both zips, to
compare with the published ones. Three things make the bytes the same on any machine:

- **The source is the commit's.** The script takes the commit's files with `git archive`,
  never the working copy, so line endings a checkout converted, or files it holds and the
  commit doesn't, change nothing. Everything the build reads is in this repository, the
  app's fonts included (`fonts/`), so the app's checkout plays no part.
- **The tools and packages are fixed.** It builds in
  [`tool/docker/Containerfile`](../tool/docker/Containerfile): Debian 12 with Node 26.13.0,
  checked against its published SHA-256. The packages are those `package-lock.json` names,
  each checked by npm against its recorded hash.
- **The zip holds nothing of the moment.** Its entries are written in path order, each dated
  1 January 1980, with one mode and one compression level.

The first run builds a container of about 440 MB. `--here` builds with the machine's own
Node instead. On the machine the script was written on, Node 26.7.0 on Windows gave the
same zips as the container.

The stores add their signatures to what they deliver. Firefox Add-ons adds files under
`META-INF/`, and the Chrome Web Store adds `_metadata/` and wraps the zip in its own format.
Every other file of an installed extension is a file of the zip, and can be compared with
it.
