#!/usr/bin/env bash
# Renders the extension's icons into icons/:
#
#   kemlock-{16,32,48,128}.png  the extension's icon, from the logo masters in
#                               the app's mobile/assets/brand ($KEMLOCK_APP, or
#                               ../kemlock): the favicon at 16 and 32, the small
#                               icon at 48, the icon at 128.
#                               The 128 is drawn at 96 pixels with the transparent
#                               edge the Chrome Web Store asks for.
#   locked-*.png                toolbar: the vault is locked (grey)
#   unlocked-*.png              toolbar: unlocked (azure)
#   sync-stopped-*.png          toolbar: sync has stopped (an orange dot)
#
# The toolbar icons are 16, 24 and 32 pixels. The popup spec's other two
# states are the browser's badge over unlocked-*.png: the count of the site's
# logins and codes on #1559C7, and "!" for a look-alike site on #9A4A06.
#
# Runs rsvg-convert in a Fedora container, as the app's mobile/tool/icons/render.sh does,
# so nothing has to be installed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
extension="$(cd "$here/../.." && pwd)"
app="${KEMLOCK_APP:-$extension/../kemlock}"
brand="$(cd "$app/mobile/assets/brand" && pwd)"
mkdir -p "$extension/icons"

# Git Bash would rewrite the container paths below as Windows paths.
export MSYS_NO_PATHCONV=1
docker run --rm -v "$here:/icons:ro" -v "$brand:/brand:ro" -v "$extension/icons:/out" fedora:44 bash -c '
  set -e
  dnf install -y -q librsvg2-tools >/dev/null
  rsvg-convert -w 16 -h 16 /brand/kemlock-favicon.svg -o /out/kemlock-16.png
  rsvg-convert -w 32 -h 32 /brand/kemlock-favicon.svg -o /out/kemlock-32.png
  rsvg-convert -w 48 -h 48 /brand/kemlock-icon-small.svg -o /out/kemlock-48.png
  rsvg-convert -w 96 -h 96 --page-width 128 --page-height 128 --left 16 --top 16 \
    /brand/kemlock-icon.svg -o /out/kemlock-128.png
  for state in locked unlocked sync-stopped; do
    for size in 16 24 32; do
      rsvg-convert -w $size -h $size /icons/$state.svg -o /out/$state-$size.png
    done
  done
'
