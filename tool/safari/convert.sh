#!/usr/bin/env bash
# Wraps the built Safari extension in an Xcode project (docs/plans/add-safari.md). Safari runs a web extension only from a
# Mac app, and `xcrun safari-web-extension-converter` is what writes that app around the extension's folder, so this runs on a
# Mac with Xcode, and nowhere else.
#
#   tool/safari/convert.sh [<folder> [<output>]]
#
#   <folder>   the built extension: dist/safari (`npm run build:safari`, or the release's kemlock-<version>-safari.zip unzipped)
#   <output>   where the project goes: dist/safari-xcode. It is made new each time.
#
# What it takes, as environment variables (all optional; the defaults make an unsigned project that builds):
#
#   KEMLOCK_SAFARI_APP_NAME     the app's name, in the Dock and the Mac App Store                  Kemlock
#   KEMLOCK_SAFARI_BUNDLE_ID    the app's bundle identifier; the extension's is this + ".Extension"  com.kemlock.browser
#   KEMLOCK_SAFARI_TEAM         your Apple Developer team id (ten characters), the only signing    none: the project is unsigned
#                               input; with it, Xcode signs automatically with that team
#   KEMLOCK_SAFARI_BUILD        the build number (CFBundleVersion), which App Store Connect wants   1
#                               to go up with each upload of the same version
#   KEMLOCK_SAFARI_MACOS        the Mac app's minimum macOS (11.0 or later)                         14.0
#   KEMLOCK_SAFARI_IOS          the iOS app's minimum iOS (15.0 or later)                           17.0
#   KEMLOCK_SAFARI_PLATFORMS    all, macos or ios                                                   all
#   KEMLOCK_SAFARI_ICON         a square PNG, 1024 pixels wide for the best result, for the app's   icons/kemlock-128.png
#                               icon (the app's mobile/assets/brand has the master)
#
# The version is the extension's own (its manifest.json), so the app's version agrees with the zip it was made from. The
# certificates, the provisioning, the App Store Connect record and the upload are the owner's: see docs/store/safari.md.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"

folder="${1:-$repo/dist/safari}"
output="${2:-$repo/dist/safari-xcode}"
app_name="${KEMLOCK_SAFARI_APP_NAME:-Kemlock}"
bundle_id="${KEMLOCK_SAFARI_BUNDLE_ID:-com.kemlock.browser}"
team="${KEMLOCK_SAFARI_TEAM:-}"
build="${KEMLOCK_SAFARI_BUILD:-1}"
macos="${KEMLOCK_SAFARI_MACOS:-14.0}"
ios="${KEMLOCK_SAFARI_IOS:-17.0}"
platforms="${KEMLOCK_SAFARI_PLATFORMS:-all}"
icon="${KEMLOCK_SAFARI_ICON:-$repo/icons/kemlock-128.png}"
# The tools, which a test replaces
xcrun_cmd="${KEMLOCK_XCRUN:-xcrun}"
sips_cmd="${KEMLOCK_SIPS:-sips}"
xcodebuild_cmd="${KEMLOCK_XCODEBUILD:-xcodebuild}"

fail() {
  echo "convert.sh: $*" >&2
  exit 1
}

[ -f "$folder/manifest.json" ] || fail "$folder has no manifest.json: build it first (npm run build:safari)"
case "$platforms" in
  all) platform_flags=() ;;
  macos) platform_flags=(--macos-only) ;;
  ios) platform_flags=(--ios-only) ;;
  *) fail "KEMLOCK_SAFARI_PLATFORMS is all, macos or ios, not $platforms" ;;
esac
# [[ =~ ]] reads the whole value, where grep reads line by line and lets one with a newline through
bundle_re='^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
name_re='^[A-Za-z0-9][A-Za-z0-9 ._-]*$'
[[ $bundle_id =~ $bundle_re ]] ||
  fail "KEMLOCK_SAFARI_BUNDLE_ID is not a bundle identifier like com.example.app: $bundle_id"
[[ $app_name =~ $name_re ]] ||
  fail "KEMLOCK_SAFARI_APP_NAME has characters a project name should not: $app_name"

# The output folder is deleted first, so it is resolved (links followed) and held against what must never go: the repository
# and anything above it, the folder this runs from, the home folder, the extension's own folder and anything that holds it, and
# the repository's own files. Inside dist/ or outside the repository it may be
# Whether $1 is $2 or inside it. Each loses its trailing slash first, so that the root, /, is above everything and not "//"
inside() { case "${1%/}/" in "${2%/}/"*) return 0 ;; esac; return 1; }
mkdir -p "$(dirname "$output")"
if [ -d "$output" ]; then
  output="$(cd "$output" && pwd -P)"
else
  output="$(cd "$(dirname "$output")" && pwd -P)/$(basename "$output")"
fi
folder_real="$(cd "$folder" && pwd -P)"
here_dir="$(pwd -P)"
unsafe=""
inside "$repo" "$output" && unsafe="the repository or a folder above it"
inside "$here_dir" "$output" && unsafe="the folder this is run from, or one above it"
inside "$folder_real" "$output" && unsafe="the extension's own folder, or one above it"
inside "${HOME:-/nonexistent}" "$output" && unsafe="the home folder, or one above it"
[ "$output" != "$repo/dist" ] || unsafe="the repository's dist folder"
if inside "$output" "$repo" && ! inside "$output" "$repo/dist"; then unsafe="a folder of the repository's own files"; fi
[ -z "$unsafe" ] || fail "the output folder is deleted first, so it is not $unsafe: $output"
if [ "$(uname -s)" != "Darwin" ] && [ -z "${KEMLOCK_XCRUN:-}" ]; then
  fail "this needs macOS with Xcode (xcrun safari-web-extension-converter)"
fi

version="$(node "$here/project.mjs" version "$folder/manifest.json")"
echo "Kemlock $version for Safari: $app_name, $bundle_id, build $build"

rm -rf "$output"
mkdir -p "$output"
# --copy-resources puts the extension's files inside the project, so it no longer reads $folder
"$xcrun_cmd" safari-web-extension-converter "$folder" \
  --project-location "$output" \
  --app-name "$app_name" \
  --bundle-identifier "$bundle_id" \
  --swift \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force \
  ${platform_flags[@]+"${platform_flags[@]}"}

project="$(find "$output" -name project.pbxproj -not -path '*/xcuserdata/*' -not -path '*/.build/*' | sort | head -n 1)"
[ -n "$project" ] || fail "the converter made no Xcode project in $output"

# The version, the build number, the deployment targets and, if given, the team
team_args=()
[ -z "$team" ] || team_args=(--team "$team")
node "$here/project.mjs" patch "$project" --version "$version" --build "$build" --macos "$macos" --ios "$ios" \
  ${team_args[@]+"${team_args[@]}"}

# The handler that answers the extension's native messages (the clipboard, the locked screen), over the converter's echo
handlers=0
while IFS= read -r handler; do
  cp "$here/SafariWebExtensionHandler.swift" "$handler"
  handlers=$((handlers + 1))
done < <(find "$output" -name SafariWebExtensionHandler.swift -not -path '*/.build/*' | sort)
[ "$handlers" -gt 0 ] || fail "the converter made no SafariWebExtensionHandler.swift to replace"

# The app's icon: every image of its icon set again, at the size it has, from the icon given
if [ -f "$icon" ]; then
  while IFS= read -r image; do
    width="$("$sips_cmd" -g pixelWidth "$image" | awk '/pixelWidth/ {print $2}')"
    height="$("$sips_cmd" -g pixelHeight "$image" | awk '/pixelHeight/ {print $2}')"
    [ -n "$width" ] && [ -n "$height" ] || continue
    "$sips_cmd" -z "$height" "$width" "$icon" --out "$image" >/dev/null
  done < <(find "$output" -path '*AppIcon.appiconset/*.png' | sort)
else
  echo "convert.sh: no icon at $icon, so the converter's own icon stays" >&2
fi

# The scheme to build is read from the project, not guessed: its name depends on the platforms it was made for
scheme=""
platform=macos
[ "$platforms" != ios ] || platform=ios
if command -v "$xcodebuild_cmd" >/dev/null 2>&1; then
  scheme="$("$xcodebuild_cmd" -list -json -project "$(dirname "$project")" 2>/dev/null |
    node "$here/project.mjs" scheme "$platform" "$app_name" 2>/dev/null)" || scheme=""
fi
[ -n "$scheme" ] || scheme="the app's scheme (xcodebuild -list -project <the .xcodeproj> shows them)"

echo
echo "The project is in $output. Open it in Xcode, set the signing team of both targets (or give KEMLOCK_SAFARI_TEAM),"
echo "and build \"$scheme\". Safari then lists Kemlock under Settings > Extensions."
