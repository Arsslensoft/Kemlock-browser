#!/usr/bin/env bash
# Builds the browser extension's zips from a commit, the same bytes on any
# machine (openspec: add-browser-extension, design decision 18):
#
#   tool/build.sh            HEAD, in the extension container
#   tool/build.sh v0.1.0     a tag or another commit
#   tool/build.sh --here     with this machine's own Node
#   tool/build.sh --version 1.2.0 <commit>   a commit, as that version's release
#
# The commit's files come from `git archive`, never the working tree, so a
# checkout's line endings or untracked files change nothing. The packages
# come from package-lock.json, which npm checks. The zips land in
# dist/release as kemlock-<version>-<browser>.zip, and their SHA-256 is
# printed. With Podman, set CONTAINER_ENGINE=podman.
#
# A release's version is its tag's: for a tag named v<x.y.z>, the build is made
# with KEMLOCK_VERSION=<x.y.z>, which tool/build.mjs puts in the manifests and
# the zips' names, so `tool/build.sh v1.2.0` rebuilds the release by itself.
# The release workflow builds the commit before it tags it, with --version, and
# gets the same bytes. Any other commit has the version of manifests/base.json.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image=kemlock-extension:node-26.13.0

usage() {
  echo "usage: $0 [--here] [--version <x.y.z>] [<commit>]" >&2
  exit 2
}

ref=HEAD
local_node=0
version=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --here) local_node=1 ;;
    --version)
      [ "$#" -ge 2 ] || usage
      version="$2"
      shift
      ;;
    -*) usage ;;
    *) ref="$1" ;;
  esac
  shift
done
commit="$(git -C "$repo" rev-parse --verify "$ref^{commit}")"

if [ -n "$version" ] && ! [[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "--version is not a version like 1.2.3: $version" >&2
  exit 2
fi
# A tag named v<x.y.z> gives its version itself, and must agree with --version
if [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] && git -C "$repo" rev-parse -q --verify "refs/tags/$ref" >/dev/null; then
  if [ -n "$version" ] && [ "$version" != "${BASH_REMATCH[1]}" ]; then
    echo "--version $version is not the version of the tag $ref" >&2
    exit 2
  fi
  version="${BASH_REMATCH[1]}"
fi
export KEMLOCK_VERSION="$version"

work="$repo/dist/source"
out="$repo/dist/release"
rm -rf "$work" "$out"
mkdir -p "$work" "$out"
git -C "$repo" -c core.autocrlf=false archive --format=tar "$commit" | tar -C "$work" -xf -
echo "building $commit ${version:+(version $version)}"

if [ "$local_node" = "1" ]; then
  (cd "$work" && npm ci --no-audit --no-fund && npm run build && node tool/zip.mjs dist "$out")
else
  "$engine" build -q -t "$image" -f "$here/docker/Containerfile" "$here/docker" >/dev/null
  # Git Bash would rewrite the container paths below as Windows paths.
  export MSYS_NO_PATHCONV=1
  "$engine" run --rm --platform linux/amd64 -e "KEMLOCK_VERSION=$version" -v "$work:/src:ro" -v "$out:/out" \
    -v kemlock-npmcache:/root/.npm "$image" \
    bash -c 'set -e; cp -r /src/. /w; cd /w; npm ci; npm run build; node tool/zip.mjs dist /out'
fi

rm -rf "$work"
cd "$out" && sha256sum ./*.zip
