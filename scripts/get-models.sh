#!/usr/bin/env bash
#
# Installs Koe's models into its models folder, checking every file
# against the SHA-256 pinned in models/manifest.json. The app itself never
# downloads anything; this script is the one time anything is fetched, and it
# only ever downloads (nothing about you or your dictations is sent).
#
# Usage:
#   scripts/get-models.sh                 the Balanced tier (~5.9 GB), the default
#   scripts/get-models.sh --tier NAME     compact (~0.5 GB), balanced, or max (~20 GB)
#   scripts/get-models.sh --list          show the tiers and every model
#   scripts/get-models.sh FILE...         specific files from the manifest
#   scripts/get-models.sh --all           every file in the manifest
#   scripts/get-models.sh --from DIR      install from a folder of already-downloaded
#                                         files (e.g. handed out by IT), no network
#   --force                               install Max even with under 32 GB of memory
#
# Several tiers can live side by side; pick which models Koe uses on its
# Models page.
#
# Models folder: ~/Library/Application Support/Koe/models
# (override with KOE_MODELS_DIR).
set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="$PWD/models/manifest.json"
DEST="${KOE_MODELS_DIR:-$HOME/Library/Application Support/Koe/models}"

field() { plutil -extract "models.$1.$2" raw -o - "$MANIFEST"; }
COUNT="$(plutil -extract models raw -o - "$MANIFEST")"

gb() { awk -v b="$1" 'BEGIN { printf "%.1f GB", b / 1e9 }'; }
in_tier() { plutil -extract "models.$1.tiers" json -o - "$MANIFEST" | grep -q "\"$2\""; }

FROM=""
WANT=()
ALL=0
TIER="balanced"
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --list)
      for t in compact balanced max; do
        total=0
        echo "$t — $(plutil -extract "tiers.$t" raw -o - "$MANIFEST")"
        for ((i = 0; i < COUNT; i++)); do
          if in_tier "$i" "$t"; then
            total=$((total + $(field "$i" size)))
            printf "    %-34s %s\n" "$(field "$i" file)" "$(gb "$(field "$i" size)")"
          fi
        done
        echo "    total $(gb "$total")"
      done
      exit 0 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) WANT+=("$1"); shift ;;
  esac
done

case "$TIER" in
  compact|balanced|max) ;;
  *) echo "Unknown tier: $TIER (use compact, balanced, or max)" >&2; exit 2 ;;
esac

# Max's cleanup model needs ~20 GB of memory on its own.
if [ "$TIER" = max ] && [ "$ALL" = 0 ] && [ ${#WANT[@]} -eq 0 ] && [ "$FORCE" = 0 ]; then
  mem=$(( $(sysctl -n hw.memsize) / 1073741824 ))
  if [ "$mem" -lt 32 ]; then
    echo "This Mac has ${mem} GB of memory; the Max tier needs 32 GB or more." >&2
    echo "Use --tier balanced, or add --force to install it anyway." >&2
    exit 2
  fi
fi

wanted() {
  local i="$1" file
  file="$(field "$i" file)"
  if [ "$ALL" = 1 ]; then return 0; fi
  if [ ${#WANT[@]} -gt 0 ]; then
    for w in "${WANT[@]}"; do [ "$w" = "$file" ] && return 0; done
    return 1
  fi
  in_tier "$i" "$TIER"
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
    echo "==> Downloading $file ($(gb "$size"))"
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
