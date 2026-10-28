//! Local-LLM cleanup worker.
//!
//! Loads a GGUF instruction model once, then serves one request per line of stdin:
//! `{"system": "...", "user": "..."}` → `{"text": "..."}` on stdout. The Koe
//! app spawns this and keeps it warm so cleanup is fast and fully offline.
//!
//! Usage: `koe-llm-worker <model.gguf> [--no-think]` (or KOE_LLM_MODEL env var).
//! `--no-think` is for hybrid Qwen3 models, which otherwise reason in a
//! `<think>` block before answering: it pre-fills an empty one, the same thing
//! Qwen3's own chat template does when thinking is disabled.

use std::io::{BufRead, Write};
use std::num::NonZeroU32;

use anyhow::Context as _;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use llama_cpp_2::sampling::LlamaSampler;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Msg {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct Request {
    /// Full multi-turn message list (system + few-shot + user). Preferred.
    #[serde(default)]
    messages: Vec<Msg>,
    /// Back-compat single-turn form, used only when `messages` is empty.
    #[serde(default)]
    system: String,
    #[serde(default)]
    user: String,
    #[serde(default = "default_max")]
    max_tokens: i32,
}
fn default_max() -> i32 {
    400
}

#[derive(Serialize)]
struct Response {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() -> anyhow::Result<()> {
    let model_path = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("KOE_LLM_MODEL").ok())
        .context("model path required (argv[1] or KOE_LLM_MODEL)")?;
    let no_think = std::env::args().skip(2).any(|a| a == "--no-think");

    let backend = LlamaBackend::init()?;
    // Offload everything to the Apple GPU (Metal) — capped by what fits.
    let model_params = LlamaModelParams::default().with_n_gpu_layers(999);
    let model = LlamaModel::load_from_file(&backend, &model_path, &model_params)
        .with_context(|| format!("failed to load model {model_path}"))?;
    eprintln!("[llm-worker] model loaded, ready");

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<Request>(&line) {
            Ok(req) => match generate(&backend, &model, &req, no_think) {
                Ok(text) => Response { text, error: None },
                Err(e) => Response {
                    text: String::new(),
                    error: Some(e.to_string()),
                },
            },
            Err(e) => Response {
                text: String::new(),
                error: Some(format!("bad request: {e}")),
            },
        };
        serde_json::to_writer(&mut stdout, &resp)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}

fn generate(backend: &LlamaBackend, model: &LlamaModel, req: &Request, no_think: bool) -> anyhow::Result<String> {
    // Qwen ChatML template. Prefer the full multi-turn message list (few-shot
    // demonstrations drive the newline/list/self-correction behavior); fall back
    // to the legacy single system+user pair.
    let mut prompt = String::new();
    if req.messages.is_empty() {
        prompt.push_str(&format!(
            "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n",
            req.system, req.user
        ));
    } else {
        for m in &req.messages {
            prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", m.role, m.content));
        }
    }
    prompt.push_str("<|im_start|>assistant\n");
    if no_think {
        prompt.push_str("<think>\n\n</think>\n\n");
    }

    let ctx_params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(4096));
    let mut ctx = model.new_context(backend, ctx_params)?;

    let tokens = model.str_to_token(&prompt, AddBos::Always)?;
    let n_prompt = tokens.len() as i32;

    let mut batch = LlamaBatch::new(4096, 1);
    let last = tokens.len() - 1;
    for (i, tok) in tokens.iter().enumerate() {
        batch.add(*tok, i as i32, &[0], i == last)?;
    }
    ctx.decode(&mut batch)?;

    let mut sampler = LlamaSampler::greedy();
    let mut n_cur = batch.n_tokens();
    let mut out = String::new();
    let limit = n_prompt + req.max_tokens;

    while n_cur <= limit {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);
        if model.is_eog_token(token) {
            break;
        }
        out.push_str(&model.token_to_str(token, Special::Tokenize)?);
        batch.clear();
        batch.add(token, n_cur, &[0], true)?;
        n_cur += 1;
        ctx.decode(&mut batch)?;
    }
    Ok(strip_think(&out).trim().to_string())
}

/// Drop a `<think>…</think>` block if a model emitted one anyway, so reasoning
/// text can never be pasted in place of the answer. A block the output budget
/// cut off before it closed leaves no answer at all: empty, so the app falls back
/// to the raw transcript.
fn strip_think(text: &str) -> &str {
    if !text.trim_start().starts_with("<think>") {
        return text;
    }
    match text.find("</think>") {
        Some(end) => &text[end + "</think>".len()..],
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::strip_think;

    #[test]
    fn strips_a_leading_think_block_only() {
        assert_eq!(strip_think("<think>\nhmm\n</think>\n\nHello."), "\n\nHello.");
        // Cut off mid-thought: no answer, never the reasoning.
        assert_eq!(strip_think("<think>\nOkay, the user wants"), "");
        assert_eq!(strip_think("Hello."), "Hello.");
        // A literal tag mid-answer is the user's text, not reasoning.
        assert_eq!(strip_think("Use <think> and </think> tags."), "Use <think> and </think> tags.");
    }
}
