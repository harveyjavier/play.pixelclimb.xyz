#!/usr/bin/env bash
# Builds the Solar2D game (github.com/hsjtechnologies/pixel-climb) for the browser into static/game/.
#
# Solar2D's Linux CLI builder can't target HTML5, so we build for Linux to get the compiled
# resource.car, then pack it into Solar2D's HTML5 template ourselves (pack.mjs mirrors
# platform/resources/webPackageApp.lua). The builder runs in a container with no network.
#
# Needs: docker, gh, unzip, zip, node.   Usage: scripts/game-web/build.sh /path/to/pixel-climb
set -euo pipefail

GAME=$(realpath "${1:?usage: build.sh /path/to/pixel-climb}")
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../../static/game"
VER=3711 # last Solar2D release that ships a Linux build
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/pixelclimb-solar2d-$VER"
SNAP="Solar2D-Linux-2024.${VER}_amd64.snap"
SOLAR="$CACHE/x/usr/local/bin/Solar2D"

mkdir -p "$CACHE"
[ -f "$CACHE/$SNAP" ] || gh release download "$VER" -R coronalabs/corona -p "$SNAP" -D "$CACHE"
[ -d "$CACHE/x" ] || docker run --rm -v "$CACHE:/c" alpine:3.20 sh -c \
  "apk add -q squashfs-tools && unsquashfs -q -d /c/x /c/$SNAP && chown -R $(id -u):$(id -g) /c/x"
docker build -q -t "solar2d-builder:$VER" "$HERE" >/dev/null

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# The game's plugins (reviewPopUp, gpgs, twitter) are Android/iOS only, and the builder has no network to
# fetch them. Build from a copy that marks them mobile-only: the builder skips them, and on the web
# require() returns Solar2D's do-nothing stub instead of failing.
cp -r "$GAME" "$TMP/game"
echo 'for _, p in pairs(settings.plugins or {}) do p.supportedPlatforms = { android = true, iphone = true } end' >> "$TMP/game/build.settings"
echo "return { platform='linux', appName='PixelClimb', appVersion='1.0', dstPath='/out', projectPath='/game', useStandardResources=true }" > "$TMP/build.lua"

# Runs as root because the builder writes temp files under /; ownership is handed back after.
docker run --rm --network none -e HOME=/tmp \
  -v "$CACHE/x:/snap/solar2d/current:ro" -v "$TMP/game:/game:ro" -v "$TMP:/out" \
  "solar2d-builder:$VER" sh -c '
    R=/snap/solar2d/current
    export LD_LIBRARY_PATH=$R/lib/x86_64-linux-gnu:$R/usr/lib/x86_64-linux-gnu
    cd $R/usr/local/bin/Solar2D && ./Solar2DBuilder build --lua /out/build.lua
    chown -R '"$(id -u):$(id -g)"' /out'
[ -f "$TMP/PixelClimb.Linux/Resources/resource.car" ] || { echo "Solar2D build failed: no resource.car" >&2; exit 1; }

unzip -q "$SOLAR/Resources/webtemplate.zip" 'html/*' -d "$TMP/tpl"
rm -rf "$OUT" && mkdir -p "$OUT"
node "$HERE/pack.mjs" "$TMP/PixelClimb.Linux/Resources" "$TMP/tpl/html" "$OUT"
echo "Built $(du -sh "$OUT" | cut -f1) into static/game/"
