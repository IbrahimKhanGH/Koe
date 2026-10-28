#!/usr/bin/env bash
#
# Publishes a Koe release on GitHub: builds the app, packages a dmg (for the
# browser) and a zip (for the install command), writes install.sh with the zip's
# SHA-256, and uploads all three as the latest release. Everyone updates by
# running the install command again.
#
# The version comes from src-tauri/tauri.conf.json; bump it there (and in the
# workspace Cargo.toml) for a new release. Re-running for the same version
# replaces that release's files.
#
# The install command only works while the repo is public: GitHub doesn't serve
# a private repo's release files to a signed-out download.
#
# Usage: scripts/release.sh
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="IbrahimKhanGH/Koe"
VERSION="$(plutil -extract version raw -o - src-tauri/tauri.conf.json)"
TAG="v$VERSION"
INSTALL="curl -fsSL https://github.com/$REPO/releases/latest/download/install.sh | bash"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit your changes first, so the release matches the code on GitHub." >&2
  exit 1
fi
git push -q origin main

scripts/build-local.sh --dmg

OUT="target/release/bundle/release"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "target/release/bundle/dmg/Koe-$VERSION.dmg" "$OUT/"
/usr/bin/ditto -c -k --keepParent target/release/bundle/macos/Koe.app "$OUT/Koe-$VERSION.zip"
SHA="$(shasum -a 256 "$OUT/Koe-$VERSION.zip" | cut -d' ' -f1)"
sed -e "s/@VERSION@/$VERSION/g" -e "s/@SHA256@/$SHA/g" packaging/install.sh.in > "$OUT/install.sh"
bash -n "$OUT/install.sh"

NOTES="## Install

Paste this into Terminal (no security warning, and run it again any time to update):

\`\`\`
$INSTALL
\`\`\`

Or download **Koe-$VERSION.dmg** below and follow **Read Me First** inside it. macOS will ask you to approve it once in System Settings → Privacy & Security → Open Anyway.

Apple Silicon Mac, macOS 14 or later. Fully local: nothing you say leaves your Mac."

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$OUT"/* --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --title "Koe $VERSION" --notes "$NOTES" --latest
else
  gh release create "$TAG" "$OUT"/* --repo "$REPO" --title "Koe $VERSION" --notes "$NOTES" --target main --latest
fi

echo
echo "Released Koe $VERSION: https://github.com/$REPO/releases/tag/$TAG"
echo "Install or update with:"
echo "  $INSTALL"
