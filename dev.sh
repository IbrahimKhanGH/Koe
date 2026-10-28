#!/bin/bash
# Run Koe in development: builds the local-LLM cleanup worker (tauri dev
# only builds the app crate), then starts the Vite UI server + the app with hot
# reload. The app loads its UI from the dev server, so the pill actually renders.
set -e
cd "$(dirname "$0")"
cargo build -p koe-llm-worker
exec ui/node_modules/.bin/tauri dev "$@"
