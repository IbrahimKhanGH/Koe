//! The model files Koe is allowed to load. `models/manifest.json` pins each
//! one to an exact download and SHA-256, and a file is only handed to whisper.cpp
//! or llama.cpp after its hash matches — so a corrupted, swapped, or tampered file
//! never reaches a model parser.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

const MANIFEST: &str = include_str!("../../../models/manifest.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelKind {
    /// Speech-to-text (whisper.cpp `ggml-*.bin`).
    Whisper,
    /// Transcript cleanup LLM (llama.cpp `.gguf`).
    Cleanup,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelSpec {
    pub kind: ModelKind,
    pub file: String,
    pub size: u64,
    pub sha256: String,
    pub url: String,
    pub recommended: bool,
}

#[derive(Deserialize)]
struct Manifest {
    models: Vec<ModelSpec>,
}

/// Every allowed model, in preference order within each kind.
pub fn manifest() -> Vec<ModelSpec> {
    serde_json::from_str::<Manifest>(MANIFEST)
        .expect("models/manifest.json is valid")
        .models
}

/// The model that will be loaded, plus any better-ranked files that were present
/// but failed verification (and were skipped), so the caller can say so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    pub rejected: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelProblem {
    /// None of the allowed files for this kind is in the models folder.
    Missing,
    /// Allowed file names were present, but none matched its pinned hash.
    FailedVerification(Vec<String>),
}

/// The best installed, verified model of `kind` in `dir`. Candidates are tried in
/// manifest order; a file whose size or hash doesn't match is skipped, never loaded.
pub fn find_verified(dir: &Path, kind: ModelKind) -> Result<Found, ModelProblem> {
    find_in(dir, kind, &manifest())
}

fn find_in(dir: &Path, kind: ModelKind, specs: &[ModelSpec]) -> Result<Found, ModelProblem> {
    let mut rejected = Vec::new();
    for spec in specs.iter().filter(|s| s.kind == kind) {
        let path = dir.join(&spec.file);
        if !path.exists() {
            continue;
        }
        if verify(&path, spec) {
            return Ok(Found { path, rejected });
        }
        rejected.push(spec.file.clone());
    }
    if rejected.is_empty() {
        Err(ModelProblem::Missing)
    } else {
        Err(ModelProblem::FailedVerification(rejected))
    }
}

/// Log which verified model was picked, and any better-ranked file that was
/// skipped because it failed verification.
pub fn log_found(prefix: &str, what: &str, found: &Found) {
    let name = found.path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();
    eprintln!("{prefix} {what} model: {name} (SHA-256 verified)");
    for file in &found.rejected {
        eprintln!("{prefix} skipped {file}: it does not match its pinned SHA-256");
    }
}

/// Whether the file at `path` is exactly the pinned file `spec` describes.
pub fn verify(path: &Path, spec: &ModelSpec) -> bool {
    // Size first: a cheap reject for a truncated download or the wrong file.
    let size_ok = std::fs::metadata(path).is_ok_and(|m| m.len() == spec.size);
    size_ok && sha256_file(path).is_ok_and(|h| h.eq_ignore_ascii_case(&spec.sha256))
}

/// Hex SHA-256 of a file, streamed so a multi-GB model never sits in memory.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("koe-models-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn spec(file: &str, contents: &[u8]) -> ModelSpec {
        let mut hasher = Sha256::new();
        hasher.update(contents);
        ModelSpec {
            kind: ModelKind::Whisper,
            file: file.into(),
            size: contents.len() as u64,
            sha256: format!("{:x}", hasher.finalize()),
            url: String::new(),
            recommended: false,
        }
    }

    #[test]
    fn manifest_entries_are_pinned() {
        let models = manifest();
        assert!(models.iter().any(|m| m.kind == ModelKind::Whisper && m.recommended));
        assert!(models.iter().any(|m| m.kind == ModelKind::Cleanup && m.recommended));
        for m in &models {
            assert_eq!(m.sha256.len(), 64, "{}", m.file);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{}", m.file);
            // Downloads come from Hugging Face over HTTPS at a fixed 40-hex commit,
            // never a moving branch like `main`.
            let rest = m.url.strip_prefix("https://huggingface.co/").expect("HF https url");
            let commit = rest.split("/resolve/").nth(1).and_then(|r| r.split('/').next());
            assert!(commit.is_some_and(|c| c.len() == 40), "{} is not commit-pinned", m.file);
            assert!(m.url.ends_with(&m.file), "{}", m.file);
        }
    }

    #[test]
    fn picks_the_first_verified_file() {
        let dir = temp_dir("pick");
        let better = spec("better.bin", b"better model");
        let fallback = spec("fallback.bin", b"fallback model");
        std::fs::write(dir.join("better.bin"), b"better model").unwrap();
        std::fs::write(dir.join("fallback.bin"), b"fallback model").unwrap();
        let found = find_in(&dir, ModelKind::Whisper, &[better, fallback]).unwrap();
        assert_eq!(found, Found { path: dir.join("better.bin"), rejected: vec![] });
    }

    #[test]
    fn tampered_file_is_skipped_for_a_good_one() {
        let dir = temp_dir("tampered");
        let better = spec("better.bin", b"better model");
        let fallback = spec("fallback.bin", b"fallback model");
        // Same size, different bytes: only the hash can catch it.
        std::fs::write(dir.join("better.bin"), b"bitter model").unwrap();
        std::fs::write(dir.join("fallback.bin"), b"fallback model").unwrap();
        let found = find_in(&dir, ModelKind::Whisper, &[better, fallback]).unwrap();
        assert_eq!(
            found,
            Found { path: dir.join("fallback.bin"), rejected: vec!["better.bin".into()] }
        );
    }

    #[test]
    fn reports_missing_vs_failed() {
        let dir = temp_dir("problems");
        let only = spec("model.bin", b"real model");
        assert_eq!(find_in(&dir, ModelKind::Whisper, &[only.clone()]), Err(ModelProblem::Missing));
        std::fs::write(dir.join("model.bin"), b"fake model").unwrap();
        assert_eq!(
            find_in(&dir, ModelKind::Whisper, &[only]),
            Err(ModelProblem::FailedVerification(vec!["model.bin".into()]))
        );
        // A kind with no entries at all is simply missing.
        assert_eq!(find_in(&dir, ModelKind::Cleanup, &[]), Err(ModelProblem::Missing));
    }
}
