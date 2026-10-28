#!/usr/bin/env bash
#
# Fails if anything that can talk to the network has crept into Koe:
# an HTTP/TLS/WebSocket client crate in the desktop builds, tokio's socket
# feature, a Tauri plugin that reaches outside the app (http, updater, shell,
# opener, websocket, upload), or a webview permission for one. Run by
# scripts/build-local.sh before every build; run it by hand any time.
#
# (Tauri's own iOS/Android targets pull in an HTTP client; those are never
# built here, so only the desktop targets are checked.)
set -euo pipefail

cd "$(dirname "$0")/.."
FAIL=0

NETWORK_CRATES='reqwest|hyper|hyper-util|h2|h3|quinn|ureq|isahc|surf|attohttpc|minreq|curl|curl-sys|rustls|native-tls|openssl|openssl-sys|tungstenite|tokio-tungstenite|async-tungstenite|tauri-plugin-(http|updater|shell|opener|websocket|upload)'

# A failed `cargo tree` (e.g. a stale Cargo.lock) must fail the check, not
# silently produce an empty — "clean" — dependency list.
tree() { cargo tree --locked --workspace --target "$target" "$@" || { echo "✗ cargo tree failed" >&2; exit 1; }; }

for target in aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
  deps="$(tree -e normal,build --prefix none)"
  found="$(echo "$deps" | sed 's/ .*//' | sort -u | grep -xE "$NETWORK_CRATES" || true)"
  if [ -n "$found" ]; then
    echo "✗ network crates in the $target build: $(echo "$found" | tr '\n' ' ')" >&2
    FAIL=1
  fi
  if tree -e features -i tokio | grep -q 'tokio feature "net"'; then
    echo "✗ tokio's \"net\" (sockets) feature is enabled in the $target build" >&2
    FAIL=1
  fi
done

if grep -E '"@tauri-apps/plugin-(http|updater|shell|opener|websocket|upload)"' ui/package.json; then
  echo "✗ ui/package.json pulls in a network-capable Tauri plugin" >&2
  FAIL=1
fi

if grep -hE '"(http|updater|shell|opener|websocket|upload):' src-tauri/capabilities/*.json; then
  echo "✗ a webview capability grants a network-capable permission" >&2
  FAIL=1
fi

if [ "$FAIL" = 1 ]; then
  echo "Koe must stay fully offline; see the README's Security section." >&2
  exit 1
fi
echo "✓ offline check passed: no network clients, sockets, or network plugins in the build"
