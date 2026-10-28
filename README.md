# Koe 声

*Koe* (声) is Japanese for "voice".

Voice dictation that never leaves your Mac. Hold a key (or press a shortcut),
speak, and clean, punctuated text is pasted wherever your cursor is.

Speech-to-text runs on-device with Whisper; an on-device LLM (Qwen) removes
fillers ("um", "like"), resolves self-corrections ("2pm, no wait, 3pm" → "3pm"),
and fixes punctuation and lists. **There is no cloud mode, no account, no
telemetry, and no network code in the app.**

## Install (macOS, Apple Silicon)

Prerequisites: Xcode command-line tools (`xcode-select --install`),
[Rust](https://rustup.rs), Node.js, and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/IbrahimKhanGH/Koe.git
cd Koe

# 1. Models, one time. Downloads from Hugging Face and checks every file
#    against its pinned SHA-256. Balanced (5.9 GB) by default; add
#    --tier compact (0.5 GB, speech only) or --tier max (20 GB, 32 GB+ Macs).
scripts/get-models.sh

# 2. Build and install the app.
scripts/build-local.sh
rm -rf /Applications/Koe.app && cp -R target/release/bundle/macos/Koe.app /Applications/
open /Applications/Koe.app
```

On first launch, grant **Microphone** and **Accessibility** when asked
(Accessibility is what lets it paste into other apps and see the Fn key).
Each rebuild is a new app to macOS, so re-grant both after reinstalling.

## Using it

| Do this | To |
|---|---|
| **Hold Fn**, speak, release | Push-to-talk: text is pasted when you let go |
| **Double-tap Fn** | Hands-free: keeps listening until you tap Fn again |
| **⌘⇧Space** (change it in Settings) | Toggle: press to start, press again to stop and paste |
| Pill **■** / **✕** buttons | Stop and paste / throw the recording away |

**Models** shows the three tiers (Compact, Balanced, Max), what's installed and
loaded, and the command to fetch the rest; pick a speech and a cleanup model or
leave both on Automatic. See [docs/MODELS.md](docs/MODELS.md).
Settings → **Cleanup engine**: *Local model* (default) or *Raw* (exactly what
Whisper heard); **Cleanup level** sets how much it edits, from None to High.
**Dictionary** holds names and terms it should always spell your way.

## Security model

Everything is designed around one rule: **nothing you say leaves the machine.**

- **No network code.** The app links no HTTP, TLS, or WebSocket client, tokio is
  built without sockets, and no network-capable Tauri plugin or webview
  permission exists. `scripts/check-offline.sh` enforces this and runs before
  every `build-local.sh` build, failing it if anything network-capable is added.
- **Locked-down UI.** A strict Content Security Policy lets the app's windows
  load only the app's own bundled files and talk only to the app itself.
- **Verified models only.** `models/manifest.json` pins each allowed model to a
  Hugging Face commit and SHA-256. The app hashes a model before loading it and
  refuses any file that doesn't match, so a corrupted, swapped, or tampered file
  never reaches whisper.cpp or llama.cpp. The model formats (`ggml`, `gguf`) are
  plain weights, not code-executing pickles.
- **Private clipboard paste.** Text is pasted through the clipboard as a
  this-Mac-only item (never synced over Universal Clipboard to other devices)
  marked concealed and transient (so clipboard managers like Raycast, Alfred, or
  Paste don't record it). Your previous clipboard, including images and files, is
  restored right after.
- **Nothing dictated is written to disk or logs.** The history list on Home is
  kept in memory only and clears when you quit. Logs never contain dictated text.
- **Hardened runtime, minimal entitlements.** Microphone is the only entitlement;
  no JIT, unsigned-memory, or library-validation exceptions.
- **Pinned dependencies.** Builds use `--locked` and `--frozen-lockfile`, so
  only the exact dependency versions in the committed lockfiles are compiled.

What *is* stored, in `~/Library/Application Support/Koe/`: your
settings, your dictionary, usage counts (words, speaking time, per-day totals,
which app was in front), and the models. Keep FileVault on.

For a second layer, a firewall like [LuLu](https://objective-see.org/products/lulu.html)
can block Koe from the network entirely; it never needs it.

## Troubleshooting

- **Nothing gets pasted.** System Settings → Privacy & Security →
  Accessibility: make sure Koe is on. After a rebuild, remove it with
  **−** and add it again, then relaunch.
- **"Speech model not found."** Run `scripts/get-models.sh`. A model that fails
  its checksum is ignored, and the log says so.
- **The toggle shortcut doesn't work.** Settings shows an error if another app
  or macOS already owns that combination; pick a different one.
- Run `./dev.sh` from a terminal to see `[koe]` log lines for every step.

## Development

```bash
pnpm --dir ui install
./dev.sh                         # app with hot-reloading UI
cargo test --workspace --exclude koe-llm-worker
scripts/check-offline.sh
```

Layout: `crates/koe-core` (state machine, cleanup prompts and gates,
dictionary, stats, settings, model verification), `koe-asr` (Whisper),
`koe-audio` (mic capture), `koe-llm-worker` (llama.cpp cleanup,
run as a separate process), `src-tauri` (the app: hotkeys, paste, permissions),
`ui` (React Hub and the floating pill).

The Windows code path compiles in principle but isn't tested in this copy;
macOS is the supported platform.

## License

MIT; see [LICENSE](LICENSE).
