//! The model files Koe is allowed to load. `models/manifest.json` pins each
//! one to an exact download and SHA-256, and a file is only handed to whisper.cpp
//! or llama.cpp after its hash matches — so a corrupted, swapped, or tampered file
//! never reaches a model parser.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MANIFEST: &str = include_str!("../../../models/manifest.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelKind {
    /// Speech-to-text (whisper.cpp `ggml-*.bin`).
    Whisper,
    /// Transcript cleanup LLM (llama.cpp `.gguf`).
    Cleanup,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelSpec {
    pub kind: ModelKind,
    pub file: String,
    /// Who made the model, its license, and the maker's official model page.
    pub maker: String,
    pub license: String,
    pub card: String,
    /// Who published this exact (converted) file.
    pub published_by: String,
    pub label: String,
    pub note: String,
    pub size: u64,
    /// Rough memory needed while loaded, for the Models page.
    pub ram_gb: f32,
    /// Which `get-models.sh --tier` installs this file.
    #[serde(default)]
    pub tiers: Vec<String>,
    /// A Qwen3 model that reasons in a <think> block first unless the prompt
    /// switches that off — the cleanup worker has to.
    #[serde(default)]
    pub hybrid: bool,
    pub sha256: String,
    pub url: String,
}

#[derive(Deserialize)]
struct Manifest {
    models: Vec<ModelSpec>,
}

/// Every allowed model, in quality order within each kind.
pub fn manifest() -> Vec<ModelSpec> {
    serde_json::from_str::<Manifest>(MANIFEST)
        .expect("models/manifest.json is valid")
        .models
}

/// The model that will be loaded, plus any files ranked ahead of it that were
/// present but failed verification (and were skipped), so the caller can say so.
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub path: PathBuf,
    pub spec: ModelSpec,
    pub rejected: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelProblem {
    /// None of the allowed files for this kind is in the models folder.
    Missing,
    /// Allowed file names were present, but none matched its pinned hash.
    FailedVerification(Vec<String>),
}

/// The model of `kind` to load from `dir`: the user's choice (`preferred`, a
/// manifest file name) if it's installed and verifies, otherwise the best
/// installed one that verifies. A file whose size or hash doesn't match is
/// skipped, never loaded.
pub fn find_preferred(dir: &Path, kind: ModelKind, preferred: Option<&str>) -> Result<Found, ModelProblem> {
    find_in(dir, kind, &preferred_first(manifest(), kind, preferred))
}

/// `specs` with the preferred file of `kind` moved to the front. A name that
/// isn't an allowed model of that kind changes nothing.
fn preferred_first(mut specs: Vec<ModelSpec>, kind: ModelKind, preferred: Option<&str>) -> Vec<ModelSpec> {
    if let Some(i) = preferred.and_then(|p| specs.iter().position(|s| s.kind == kind && s.file == p)) {
        let chosen = specs.remove(i);
        specs.insert(0, chosen);
    }
    specs
}

fn find_in(dir: &Path, kind: ModelKind, specs: &[ModelSpec]) -> Result<Found, ModelProblem> {
    let mut rejected = Vec::new();
    for spec in specs.iter().filter(|s| s.kind == kind) {
        let path = dir.join(&spec.file);
        if !path.exists() {
            continue;
        }
        if verify(&path, spec) {
            return Ok(Found { path, spec: spec.clone(), rejected });
        }
        rejected.push(spec.file.clone());
    }
    if rejected.is_empty() {
        Err(ModelProblem::Missing)
    } else {
        Err(ModelProblem::FailedVerification(rejected))
    }
}

/// Log which verified model was picked, and any file ranked ahead of it that was
/// skipped because it failed verification.
pub fn log_found(prefix: &str, what: &str, found: &Found) {
    eprintln!("{prefix} {what} model: {} (SHA-256 verified)", found.spec.file);
    for file in &found.rejected {
        eprintln!("{prefix} skipped {file}: it does not match its pinned SHA-256");
    }
}

/// Whether `spec`'s file is in `dir` at the right size: a quick check for the
/// Models page. Loading still verifies the full hash.
pub fn installed(dir: &Path, spec: &ModelSpec) -> bool {
    std::fs::metadata(dir.join(&spec.file)).is_ok_and(|m| m.len() == spec.size)
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
            maker: String::new(),
            license: String::new(),
            card: String::new(),
            published_by: String::new(),
            label: file.into(),
            note: String::new(),
            size: contents.len() as u64,
            ram_gb: 0.0,
            tiers: vec![],
            hybrid: false,
            sha256: format!("{:x}", hasher.finalize()),
            url: String::new(),
        }
    }

    #[test]
    fn manifest_entries_are_pinned() {
        let models = manifest();
        // Every tier installs one speech model; Balanced and Max also one cleanup
        // model, while Compact is speech-only.
        let count = |tier: &str, kind: ModelKind| {
            models.iter().filter(|m| m.kind == kind && m.tiers.iter().any(|t| t == tier)).count()
        };
        for (tier, cleanup) in [("compact", 0), ("balanced", 1), ("max", 1)] {
            assert_eq!(count(tier, ModelKind::Whisper), 1, "{tier} speech");
            assert_eq!(count(tier, ModelKind::Cleanup), cleanup, "{tier} cleanup");
        }
        for m in &models {
            assert_eq!(m.sha256.len(), 64, "{}", m.file);
            assert!(m.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{}", m.file);
            // Downloads come from Hugging Face over HTTPS at a fixed 40-hex commit,
            // never a moving branch like `main`.
            let rest = m.url.strip_prefix("https://huggingface.co/").expect("HF https url");
            let commit = rest.split("/resolve/").nth(1).and_then(|r| r.split('/').next());
            assert!(commit.is_some_and(|c| c.len() == 40), "{} is not commit-pinned", m.file);
            assert!(m.url.ends_with(&m.file), "{}", m.file);
            // Official and usable at work: a named maker, a permissive license,
            // and a model card on the maker's own Hugging Face page.
            assert!(!m.maker.is_empty() && !m.published_by.is_empty(), "{}", m.file);
            assert!(["MIT", "Apache 2.0"].contains(&m.license.as_str()), "{} license {}", m.file, m.license);
            assert!(m.card.starts_with("https://huggingface.co/"), "{}", m.file);
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
        assert_eq!(found.path, dir.join("better.bin"));
        assert!(found.rejected.is_empty());
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
        assert_eq!(found.path, dir.join("fallback.bin"));
        assert_eq!(found.rejected, vec!["better.bin".to_string()]);
    }

    #[test]
    fn preferred_model_is_tried_first_and_others_fall_back() {
        let dir = temp_dir("preferred");
        let better = spec("better.bin", b"better model");
        let lighter = spec("lighter.bin", b"lighter model");
        std::fs::write(dir.join("better.bin"), b"better model").unwrap();
        std::fs::write(dir.join("lighter.bin"), b"lighter model").unwrap();
        let specs = vec![better.clone(), lighter.clone()];

        // Chosen and installed: it wins over the higher-ranked one.
        let order = preferred_first(specs.clone(), ModelKind::Whisper, Some("lighter.bin"));
        assert_eq!(find_in(&dir, ModelKind::Whisper, &order).unwrap().path, dir.join("lighter.bin"));

        // Chosen but gone: falls back to the best one installed.
        std::fs::remove_file(dir.join("lighter.bin")).unwrap();
        let order = preferred_first(specs.clone(), ModelKind::Whisper, Some("lighter.bin"));
        assert_eq!(find_in(&dir, ModelKind::Whisper, &order).unwrap().path, dir.join("better.bin"));

        // A name that isn't an allowed model changes nothing.
        let order = preferred_first(specs, ModelKind::Whisper, Some("../../evil.bin"));
        assert_eq!(order[0].file, "better.bin");
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
