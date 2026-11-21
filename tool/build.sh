#!/usr/bin/env bash
# Builds the browser extension's zips from a commit, the same bytes on any
# machine (openspec: add-browser-extension, design decision 18):
#
#   extension/tool/build.sh            HEAD, in the extension container
#   extension/tool/build.sh v0.1.0     a tag or another commit
#   extension/tool/build.sh --here     with this machine's own Node
#
# The commit's files come from `git archive`, never the working tree, so a
# checkout's line endings or untracked files change nothing. The packages
# come from package-lock.json, which npm checks. The zips land in
# extension/dist/release as kemlock-<version>-<browser>.zip, and their
# SHA-256 is printed. With Podman, set CONTAINER_ENGINE=podman.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
extension="$(cd "$here/.." && pwd)"
repo="$(cd "$extension/.." && pwd)"
engine="${CONTAINER_ENGINE:-docker}"
image=kemlock-extension:node-26.13.0

ref=HEAD
local_node=0
for arg in "$@"; do
  case "$arg" in
    --here) local_node=1 ;;
    -*) echo "usage: $0 [--here] [<commit>]" >&2; exit 2 ;;
    *) ref="$arg" ;;
  esac
done
commit="$(git -C "$repo" rev-parse --verify "$ref^{commit}")"

# What the build reads: the extension, and the app's fonts it bundles
paths=(extension mobile/assets/fonts)

work="$extension/dist/source"
out="$extension/dist/release"
rm -rf "$work" "$out"
mkdir -p "$work" "$out"
git -C "$repo" -c core.autocrlf=false archive --format=tar "$commit" "${paths[@]}" | tar -C "$work" -xf -
echo "building $commit"

if [ "$local_node" = "1" ]; then
  (cd "$work/extension" && npm ci --no-audit --no-fund && npm run build && node tool/zip.mjs dist "$out")
else
  "$engine" build -q -t "$image" --target extension -f "$repo/mobile/tool/docker/Containerfile" \
    "$repo/mobile/tool/docker" >/dev/null
  # Git Bash would rewrite the container paths below as Windows paths.
  export MSYS_NO_PATHCONV=1
  "$engine" run --rm --platform linux/amd64 -v "$work:/src:ro" -v "$out:/out" \
    -v kemlock-npmcache:/root/.npm "$image" \
    bash -c 'set -e; cp -r /src/. /w; cd /w/extension; npm ci; npm run build; node tool/zip.mjs dist /out'
fi

rm -rf "$work"
cd "$out" && sha256sum ./*.zip
