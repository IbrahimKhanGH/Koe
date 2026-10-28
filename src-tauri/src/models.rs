//! Picking which verified model to load, and the Models page's view of every
//! allowed model: installed or not, loaded right now or not.

use std::path::PathBuf;
use std::sync::Mutex;

use koe_core::models::{Found, ModelKind, ModelProblem, ModelSpec};
use serde::Serialize;

/// What was loaded this session, and files skipped for failing verification.
struct Loaded {
    speech: Option<String>,
    cleanup: Option<String>,
    rejected: Vec<String>,
}

static LOADED: Mutex<Loaded> = Mutex::new(Loaded { speech: None, cleanup: None, rejected: Vec::new() });

pub fn models_dir() -> PathBuf {
    crate::local_llm::app_support_dir().join("models")
}

/// The model of `kind` to load: the user's choice if it's installed and
/// verifies, otherwise the best verified one. Logs the outcome and records it
/// for the Models page.
pub fn choose(kind: ModelKind, preferred: Option<&str>, log_prefix: &str) -> Option<Found> {
    let what = match kind {
        ModelKind::Whisper => "speech",
        ModelKind::Cleanup => "cleanup",
    };
    let dir = models_dir();
    // Hash first (seconds, for a multi-GB file), then take the lock briefly, so
    // the Models page never waits on a verification in progress.
    let result = koe_core::models::find_preferred(&dir, kind, preferred);
    let mut loaded = LOADED.lock().unwrap();
    match result {
        Ok(found) => {
            koe_core::models::log_found(log_prefix, what, &found);
            loaded.rejected.extend(found.rejected.iter().cloned());
            let file = Some(found.spec.file.clone());
            match kind {
                ModelKind::Whisper => loaded.speech = file,
                ModelKind::Cleanup => loaded.cleanup = file,
            }
            Some(found)
        }
        Err(problem) => {
            eprintln!("{log_prefix} no usable {what} model in {}: {problem:?}", dir.display());
            if let ModelProblem::FailedVerification(files) = problem {
                loaded.rejected.extend(files);
            }
            None
        }
    }
}

#[derive(Serialize)]
pub struct ModelInfo {
    #[serde(flatten)]
    spec: ModelSpec,
    /// In the models folder at the right size (the full hash is checked on load).
    installed: bool,
    /// Loaded and in use this session.
    active: bool,
    /// Present but failed its SHA-256 check, so it was skipped.
    failed_check: bool,
}

#[derive(Serialize)]
pub struct ModelsReport {
    dir: String,
    models: Vec<ModelInfo>,
}

pub fn report() -> ModelsReport {
    let dir = models_dir();
    let loaded = LOADED.lock().unwrap();
    let models = koe_core::models::manifest()
        .into_iter()
        .map(|spec| {
            let active = match spec.kind {
                ModelKind::Whisper => loaded.speech.as_deref() == Some(spec.file.as_str()),
                ModelKind::Cleanup => loaded.cleanup.as_deref() == Some(spec.file.as_str()),
            };
            ModelInfo {
                installed: koe_core::models::installed(&dir, &spec),
                failed_check: loaded.rejected.contains(&spec.file),
                active,
                spec,
            }
        })
        .collect();
    ModelsReport { dir: dir.display().to_string(), models }
}
