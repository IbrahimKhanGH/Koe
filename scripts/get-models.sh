#!/usr/bin/env bash
#
# Installs Koe's models into its models folder, checking every file
# against the SHA-256 pinned in models/manifest.json. The app itself never
# downloads anything; this script is the one time anything is fetched, and it
# only ever downloads (nothing about you or your dictations is sent).
#
# Usage:
#   scripts/get-models.sh                 the recommended models (~5.9 GB)
#   scripts/get-models.sh FILE...         specific files from the manifest
#   scripts/get-models.sh --all           every file in the manifest
#   scripts/get-models.sh --from DIR      install from a folder of already-downloaded
#                                         files (e.g. handed out by IT), no network
#
# Models folder: ~/Library/Application Support/Koe/models
# (override with KOE_MODELS_DIR).
set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="$PWD/models/manifest.json"
DEST="${KOE_MODELS_DIR:-$HOME/Library/Application Support/Koe/models}"

field() { plutil -extract "models.$1.$2" raw -o - "$MANIFEST"; }
COUNT="$(plutil -extract models raw -o - "$MANIFEST")"

FROM=""
WANT=()
ALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) WANT+=("$1"); shift ;;
  esac
done

wanted() {
  local i="$1" file
  file="$(field "$i" file)"
  if [ "$ALL" = 1 ]; then return 0; fi
  if [ ${#WANT[@]} -gt 0 ]; then
    for w in "${WANT[@]}"; do [ "$w" = "$file" ] && return 0; done
    return 1
  fi
  [ "$(field "$i" recommended)" = "true" ]
}

for w in "${WANT[@]+"${WANT[@]}"}"; do
  found=0
  for ((i = 0; i < COUNT; i++)); do [ "$(field "$i" file)" = "$w" ] && found=1; done
  [ "$found" = 1 ] || { echo "Not in models/manifest.json: $w" >&2; exit 2; }
done

verify() { # path size sha256
  [ -f "$1" ] || return 1
  [ "$(stat -f %z "$1")" = "$2" ] || return 1
  [ "$(shasum -a 256 "$1" | cut -d' ' -f1)" = "$3" ]
}

mkdir -p "$DEST"
for ((i = 0; i < COUNT; i++)); do
  wanted "$i" || continue
  file="$(field "$i" file)"
  size="$(field "$i" size)"
  sha="$(field "$i" sha256)"
  url="$(field "$i" url)"
  target="$DEST/$file"

  if verify "$target" "$size" "$sha"; then
    echo "✓ $file already installed and verified"
    continue
  fi

  partial="$target.partial"
  if [ -n "$FROM" ]; then
    echo "==> Copying $file from $FROM"
    cp "$FROM/$file" "$partial"
  else
    echo "==> Downloading $file ($((size / 1000000)) MB)"
    # HTTPS only, including every redirect; resumes an interrupted download.
    curl --fail --location --proto '=https' --tlsv1.2 --continue-at - \
      --output "$partial" "$url"
  fi

  echo "    verifying SHA-256…"
  if verify "$partial" "$size" "$sha"; then
    mv "$partial" "$target"
    echo "✓ $file verified and installed"
  else
    rm -f "$partial"
    echo "✗ $file does NOT match its pinned checksum — deleted, not installed." >&2
    exit 1
  fi
done

echo
echo "Models folder: $DEST"
echo "Relaunch Koe to pick them up."
