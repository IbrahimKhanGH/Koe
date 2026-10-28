# Models

Koe runs two open models entirely on your Mac:

| Model | Job | Default file | Size | License |
|---|---|---|---|---|
| **Whisper large-v3-turbo** (OpenAI) | Speech → text | `ggml-large-v3-turbo.bin` | 1.6 GB | MIT |
| **Qwen3-4B-Instruct-2507**, Q8_0 (Alibaba) | Cleans up the text | `qwen3-4b-instruct-2507-q8_0.gguf` | 4.3 GB | Apache 2.0 |

Together they use about 6 GB of memory and run on the GPU (Metal).

## Installing them

```bash
scripts/get-models.sh
```

That downloads both into `~/Library/Application Support/Koe/models/`
and checks each one's SHA-256 before installing it. Re-running it is safe:
files already installed and verified are skipped. Other options:

```bash
scripts/get-models.sh ggml-base.en.bin       # a specific file from the manifest
scripts/get-models.sh --all                  # every file in the manifest
scripts/get-models.sh --from /path/to/files  # install from a folder of files someone
                                             # already downloaded; no network at all
```

Smaller Whisper models (`ggml-medium.en.bin`, `ggml-small.en.bin`,
`ggml-base.en.bin`) are listed too, for slower machines. If several are
installed, the app uses the most accurate one that verifies.

## How verification works

[`models/manifest.json`](../models/manifest.json) is the allow-list. For every
file it pins:

- the **download URL**, at an exact Hugging Face commit (not a branch that can
  change), from the official publishers: `ggerganov/whisper.cpp` (the
  whisper.cpp author) and `ggml-org` (the llama.cpp maintainers);
- the **size** and **SHA-256**, which are the Git LFS ids Hugging Face shows on
  each file's page, so you can check them yourself.

The setup script refuses to install a file whose hash doesn't match, and **the
app itself re-hashes a model before every load** and won't load one that doesn't
match. A file you copy in by hand gets exactly the same check. So nobody has to
trust a server or a download: if the bytes aren't exactly the pinned file, it
never runs.

The files are model weights only. `ggml` and `gguf` are data formats that don't
execute code when loaded (unlike PyTorch `.pt`/pickle files), and the hash check
means even a crafted file aimed at a parser bug is rejected before parsing.

## Changing or adding a model

Add an entry to `models/manifest.json` with the file's Hugging Face
`/resolve/<commit>/` URL, its exact size in bytes, and its SHA-256. You can get
both from the Hugging Face API, e.g.:

```bash
curl -s https://huggingface.co/api/models/ggml-org/Qwen3-4B-Instruct-2507-Q8_0-GGUF/tree/main
```

Then run `cargo test -p koe-core models`, which checks that every entry is
commit-pinned and well-formed.
