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

/// Open Terminal running the download script bundled in Koe.app for `target`:
/// a tier name or a model file from the manifest, nothing else. Koe itself never
/// touches the network; the script does, in a window the user can watch.
#[cfg(not(target_os = "macos"))]
pub fn open_download(_app: &tauri::AppHandle, _target: &str) -> Result<(), String> {
    Err("In-app model download is macOS-only; run scripts/get-models.sh".into())
}

#[cfg(target_os = "macos")]
pub fn open_download(app: &tauri::AppHandle, target: &str) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use tauri::Manager;

    let arg = if ["compact", "balanced", "max"].contains(&target) {
        format!("--tier {target}")
    } else if koe_core::models::manifest().iter().any(|m| m.file == target) {
        shell_quote(target)
    } else {
        return Err(format!("not a known model or tier: {target}"));
    };

    // Bundled at Contents/Resources/scripts; in dev, the repo's own copy.
    let bundled = app.path().resource_dir().map(|d| d.join("scripts/get-models.sh"));
    let script = match bundled {
        Ok(path) if path.exists() => path,
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/get-models.sh"),
    };

    let command_file = std::env::temp_dir().join("koe-get-models.command");
    let body = format!(
        "#!/bin/bash\nclear\necho \"Koe — downloading models. Nothing about you is sent; files are checked before install.\"\necho\n{} {arg}\necho\nread -n 1 -s -r -p \"Press any key to close this window.\"\n",
        shell_quote(&script.to_string_lossy()),
    );
    std::fs::write(&command_file, body).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&command_file, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .args(["-a", "Terminal"])
        .arg(&command_file)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Open a model's official page (its "card", from the manifest) in the browser.
/// Only manifest URLs are ever opened, and the browser does the fetching — Koe
/// itself still makes no connection.
pub fn open_card(file: &str) -> Result<(), String> {
    let card = koe_core::models::manifest()
        .into_iter()
        .find(|m| m.file == file)
        .map(|m| m.card)
        .ok_or_else(|| format!("not a known model: {file}"))?;
    std::process::Command::new("open").arg(card).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Single-quote for a POSIX shell: 'it'\''s'.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::shell_quote;

    #[test]
    fn shell_quote_survives_quotes_and_spaces() {
        assert_eq!(shell_quote("/Applications/Koe.app/x y"), "'/Applications/Koe.app/x y'");
        assert_eq!(shell_quote("it's"), r"'it'\''s'");
    }
}
