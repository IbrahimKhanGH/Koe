# Models

Koe uses two kinds of model. Both are **official releases from their makers under
open licenses that allow use at work (including commercially)**, and both run
entirely on your Mac:

- **Speech:** Whisper, by OpenAI, turns your voice into text.
- **Cleanup:** Qwen3, by Alibaba Cloud's Qwen team, removes fillers, applies your
  spoken self-corrections ("at 3, no wait, 4" → "at 4"), and formats lists.

| File | Made by | License | This file published by | Model card |
|---|---|---|---|---|
| Whisper large-v3 turbo | OpenAI | MIT | whisper.cpp's author | [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) |
| Whisper small (English) | OpenAI | Apache 2.0 | whisper.cpp's author | [openai/whisper-small.en](https://huggingface.co/openai/whisper-small.en) |
| Whisper base (English) | OpenAI | Apache 2.0 | whisper.cpp's author | [openai/whisper-base.en](https://huggingface.co/openai/whisper-base.en) |
| Qwen3 4B Instruct | Qwen team, Alibaba Cloud | Apache 2.0 | llama.cpp's maintainers | [Qwen/Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) |
| Qwen3 30B-A3B | Qwen team, Alibaba Cloud | Apache 2.0 | the Qwen team | [Qwen/Qwen3-30B-A3B](https://huggingface.co/Qwen/Qwen3-30B-A3B) |

The Models page in Koe shows the same details, with a link to each model card. A test
(`cargo test -p koe-core models`) fails if any model lacks a maker, an MIT/Apache 2.0
license, or an official model page.

## Tiers

| Tier | Speech | Cleanup | Download | Memory |
|---|---|---|---|---|
| **Compact** | Whisper small | none | 0.5 GB | ~1 GB |
| **Balanced** (default) | Whisper large-v3 turbo | Qwen3 4B Instruct (Q8) | 5.9 GB | ~7 GB |
| **Max** | Whisper large-v3 turbo | Qwen3 30B-A3B (Q4) | 20.2 GB | ~22 GB the whole time Koe runs; best with 48 GB+, needs 32 GB |

- **Compact** pastes what you said with Whisper's punctuation and capitals, but doesn't
  rewrite. Smaller cleanup models were tested and rejected: Qwen3 1.7B left "uh"/"um"
  in and ignored self-corrections, and Qwen2.5 1.5B sometimes replied with unrelated text.
- **Balanced** handled every test (fillers, self-corrections, spoken lists) and takes
  about 3.5 s per cleanup on an M1 Pro, less on newer chips.
- **Max**'s cleanup model is a mixture-of-experts: 30B parameters, of which about 3B do
  the work for each word, so it should run at a speed similar to the 4B with stronger
  rewriting. It hasn't been tested yet; try it on a 32 GB+ Mac before recommending it.

## Installing

```bash
scripts/get-models.sh                  # Balanced
scripts/get-models.sh --tier compact   # or max
scripts/get-models.sh --list           # every tier and file, with sizes
```

Files go to `~/Library/Application Support/Koe/models/`. Tiers can live side by side;
re-running is safe, since files already installed and verified are skipped. To install
files someone already downloaded (for example, handed out by IT), with no network at all:

```bash
scripts/get-models.sh --from /path/to/folder --tier balanced
```

**Choosing in the app:** the **Models** page shows every model, what's installed, and
what's loaded. Pick one per kind, or leave it on *Automatic* (the best one installed),
then restart Koe when it asks.

**Why the app can't download models itself:** Koe contains no network code at all,
which `scripts/check-offline.sh` enforces on every build. That's the guarantee nothing
you say can leave the Mac. The script is the only thing that ever touches the network,
and it only downloads.

## How verification works

[`models/manifest.json`](../models/manifest.json) is the allow-list. For every file it
pins:

- the **download URL**, at an exact Hugging Face commit (not a branch that can change),
  from official publishers only: `ggerganov/whisper.cpp` (the whisper.cpp author),
  `ggml-org` (the llama.cpp maintainers), and `Qwen` (the model's makers);
- the **size** and **SHA-256**, which are the Git LFS ids Hugging Face shows on each
  file's page, so you can check them yourself.

The script refuses to install a file whose hash doesn't match, and **the app re-hashes a
model before every load** and won't load one that doesn't match, including a file
copied in by hand. The formats (`ggml`, `gguf`) are plain weights that don't execute
code when loaded, unlike PyTorch pickle files. The hash check also means even a file
crafted to exploit a parser bug is rejected before it's parsed.

## Changing or adding a model

Add an entry to `models/manifest.json` with the file's `/resolve/<commit>/` URL, exact
size in bytes, and SHA-256 (from the Hugging Face API, e.g.
`curl -s https://huggingface.co/api/models/<repo>/tree/main`). Mark Qwen3 models that
reason before answering (anything that isn't an "Instruct-2507" build) with
`"hybrid": true` so the worker switches thinking off. Then:

```bash
cargo test -p koe-core models     # every entry commit-pinned and well-formed
cargo run -q -p koe-core --example cleanup_request -- "um so meet at 2 no wait 3" \
  | target/release/koe-llm-worker ~/Library/Application\ Support/Koe/models/<file> [--no-think]
```

The second command sends the exact request Koe would send, so you can judge a model's
cleanup quality before shipping it.
