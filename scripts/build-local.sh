#!/usr/bin/env bash
#
# Builds Koe.app for use on this Mac only: ad-hoc signed (no Apple
# Developer account needed), hardened runtime on, with the on-device cleanup
# worker bundled next to the app executable (where `worker_bin_path()` looks
# first). For a signed + notarized build to hand to other people, use
# scripts/build-macos.sh instead.
#
# An ad-hoc signature changes on every rebuild, so macOS treats each build as a
# new app: re-grant Microphone and Accessibility after installing a new build.
#
# Usage: scripts/build-local.sh
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

TAURI="$REPO_ROOT/ui/node_modules/.bin/tauri"
if [ ! -x "$TAURI" ]; then
  echo "Tauri CLI missing — run 'pnpm --dir ui install' first." >&2
  exit 1
fi

# Refuse to build if anything network-capable has crept in.
scripts/check-offline.sh

# --locked / --frozen-lockfile: build exactly the dependency versions in the
# committed lockfiles, never newer ones resolved at build time.
echo "==> Installing UI dependencies (frozen lockfile)…"
pnpm --dir ui install --frozen-lockfile

echo "==> Building the local-LLM worker…"
cargo build --locked --release -p koe-llm-worker

echo "==> Building Koe.app…"
"$TAURI" build --bundles app -- --locked

APP="$REPO_ROOT/target/release/bundle/macos/Koe.app"
[ -d "$APP" ] || { echo "No Koe.app was produced." >&2; exit 1; }

echo "==> Bundling the worker and signing (ad-hoc, hardened runtime)…"
cp "$REPO_ROOT/target/release/koe-llm-worker" "$APP/Contents/MacOS/koe-llm-worker"
codesign --force --options runtime --sign - "$APP/Contents/MacOS/koe-llm-worker"
codesign --force --options runtime --entitlements "$REPO_ROOT/src-tauri/Entitlements.plist" \
  --sign - "$APP"
codesign --verify --strict --verbose=1 "$APP"

echo
echo "App: $APP"
echo "Install with: rm -rf /Applications/Koe.app && cp -R \"$APP\" /Applications/"
