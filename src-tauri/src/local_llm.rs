//! Spawns and talks to the local-LLM cleanup worker (a separate process, so
//! llama.cpp and whisper.cpp never link into the same binary). One JSON request
//! per line over stdio: `{system,user}` -> `{text}`.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

pub struct LocalWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl LocalWorker {
    pub fn spawn(worker_bin: &Path, model: &Path) -> anyhow::Result<Self> {
        let mut child = Command::new(worker_bin)
            .arg(model)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("no stdin"))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| anyhow::anyhow!("no stdout"))?);
        Ok(Self { child, stdin, stdout })
    }

    /// Send one cleanup request (system prompt + few-shot turns + transcript) and
    /// read the response (blocks until the line comes).
    pub fn cleanup(
        &mut self,
        messages: &[koe_core::cleanup::CleanupMsg],
    ) -> anyhow::Result<String> {
        // Size the output budget to the transcript, so a long dictation is not
        // truncated mid-sentence with its last words dropped. The cleaned text is about as long as what was said, and the
        // real transcript is the LAST message (the few-shot turns come before
        // it); ~4 chars/token, doubled for reformatting headroom, floored at 400
        // so a short dictation is unchanged and fast.
        let transcript_chars = messages.last().map(|m| m.content.chars().count()).unwrap_or(0);
        let max_tokens = (transcript_chars / 2).max(400);
        let req = serde_json::json!({ "messages": messages, "max_tokens": max_tokens });
        let mut line = serde_json::to_string(&req)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()?;

        let mut resp = String::new();
        if self.stdout.read_line(&mut resp)? == 0 {
            anyhow::bail!("local worker closed");
        }
        let v: serde_json::Value = serde_json::from_str(&resp)?;
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            anyhow::bail!("local llm: {err}");
        }
        Ok(v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string())
    }
}

impl Drop for LocalWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Platform application-support dir: `~/Library/Application Support/Koe`
/// on macOS, `%APPDATA%\Koe` on Windows.
fn app_support_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(base).join("Koe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/Koe")
    }
}

/// Find the worker binary: next to the app executable (bundled), else the dev build dir.
pub fn worker_bin_path() -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        "koe-llm-worker.exe"
    } else {
        "koe-llm-worker"
    };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join(exe_name);
            if cand.exists() {
                return Some(cand);
            }
        }
    }
    // Dev fallback: this checkout's own `target/` dir, wherever it was cloned.
    // `dev.sh` builds the worker into `target/debug`; check `release` too.
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../target");
    ["debug", "release"]
        .iter()
        .map(|profile| target.join(profile).join(exe_name))
        .find(|p| p.exists())
}

/// Spawn the worker if the binary is present and a cleanup model in the models
/// dir (same one as whisper's) matches its pinned SHA-256 in models/manifest.json.
pub fn spawn_default() -> Option<LocalWorker> {
    let bin = worker_bin_path()?;
    let dir = app_support_dir().join("models");
    let model = match koe_core::models::find_verified(&dir, koe_core::ModelKind::Cleanup) {
        Ok(found) => {
            koe_core::models::log_found("[koe]", "cleanup", &found);
            found.path
        }
        Err(problem) => {
            eprintln!("[koe] no usable cleanup model in {}: {problem:?}", dir.display());
            return None;
        }
    };
    match LocalWorker::spawn(&bin, &model) {
        Ok(w) => {
            eprintln!("[koe] local LLM worker started ({})", bin.display());
            Some(w)
        }
        Err(e) => {
            eprintln!("[koe] local LLM worker failed to start: {e}");
            None
        }
    }
}
