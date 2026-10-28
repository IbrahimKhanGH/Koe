//! The macOS dictation pipeline. An in-process CoreGraphics event tap feeds Fn
//! key-down / key-up (and the toggle shortcut) into the [`koe_core`] state
//! machine; its actions drive mic capture, Whisper transcription, on-device
//! cleanup, the paste, and the `koe://flowbar/state` events the pill renders.

/// Dictionary entry shape sent to the Hub UI (auto-learned entries flagged).
#[derive(Clone, serde::Serialize)]
pub struct DictEntryDto {
    pub correct: String,
    pub mishears: Vec<String>,
    pub auto: bool,
}

#[cfg(target_os = "macos")]
mod imp {
    use std::os::raw::c_void;
    use std::path::PathBuf;
    use super::DictEntryDto;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use koe_core::state::{Action, BarState};
    use koe_core::{
        AsrEngine, CleanupContext, CleanupMode, Input, ModelKind, PipelineEvent, StateMachine,
        TriggerToken,
    };
    use koe_ipc::BindingId;

    const OVERLAY_LABEL: &str = "koe_bar";

    // --- CoreGraphics / CoreFoundation FFI (listen-only Fn tap) -----------
    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CFStringRef = *const c_void;
    type CFAllocatorRef = *const c_void;
    type CGEventRef = *mut c_void;
    type CGEventTapProxy = *mut c_void;
    type CGEventTapCallBack =
        extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            place: u32,
            options: u32,
            events_of_interest: u64,
            callback: CGEventTapCallBack,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFMachPortCreateRunLoopSource(
            allocator: CFAllocatorRef,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFStringRef);
        fn CFRunLoopRun();
        static kCFRunLoopDefaultMode: CFStringRef;
    }

    const K_CG_SESSION_EVENT_TAP: u32 = 1;
    const K_CG_HEAD_INSERT: u32 = 0;
    const K_CG_TAP_OPTION_LISTEN_ONLY: u32 = 1;
    const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const EVENTS_OF_INTEREST: u64 = 1 << K_CG_EVENT_FLAGS_CHANGED;
    const FLAG_SECONDARY_FN: u64 = 0x0080_0000;
    const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const KEYCODE_FN: i64 = 63;
    const K_CG_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const K_CG_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static MACHINE: OnceLock<Mutex<StateMachine>> = OnceLock::new();
    static CLOCK: OnceLock<Instant> = OnceLock::new();
    static FN_IS_DOWN: AtomicBool = AtomicBool::new(false);
    static TAP_PORT: AtomicPtr<c_void> = AtomicPtr::new(null_mut());
    /// Set once at startup if no Whisper model file exists on disk at all —
    /// distinct from "still loading", so the finalize path only shows the
    /// user a loud "no speech model" error for the real case, not a race
    /// against the ~1s background load right after launch.
    static ASR_MODEL_MISSING: AtomicBool = AtomicBool::new(false);
    /// Bundle id of the app that was frontmost at record-start = the paste target.
    /// Cleanup uses it to format for the medium (email vs. text vs. chat).
    static TARGET_APP: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    static CAPTURE: OnceLock<Mutex<Option<koe_audio::CaptureHandle>>> = OnceLock::new();
    static ASR: OnceLock<Arc<koe_asr::WhisperEngine>> = OnceLock::new();
    static LOCAL: OnceLock<Mutex<Option<crate::local_llm::LocalWorker>>> = OnceLock::new();
    static SETTINGS: OnceLock<Mutex<koe_core::Settings>> = OnceLock::new();
    static DICTIONARY: OnceLock<Mutex<koe_core::DictionaryStore>> = OnceLock::new();
    static STATS: OnceLock<Mutex<koe_core::StatsStore>> = OnceLock::new();

    #[derive(Clone, Serialize)]
    struct BarPayload {
        state: &'static str,
    }

    #[derive(Clone, Serialize)]
    struct WavePayload {
        bars: Vec<f32>,
    }

    #[derive(Clone, Serialize)]
    struct TranscriptPayload {
        text: String,
    }


    fn support_dir() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support/Koe")
    }
    fn settings_path() -> PathBuf {
        support_dir().join("settings.json")
    }
    fn dict_path() -> PathBuf {
        support_dir().join("dictionary.json")
    }
    fn stats_path() -> PathBuf {
        support_dir().join("stats.json")
    }

    /// Seconds since the Unix epoch (UTC), or 0 if the clock is before the epoch.
    fn unix_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Log one completed dictation to the stats store (words, speaking time, text,
    /// target app) and persist it. Powers both the Hub stats and the history list.
    pub fn record_dictation(text: &str, duration_secs: f32) {
        let words = koe_core::stats::count_words(text);
        if words == 0 {
            return;
        }
        let app = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        if let Some(m) = STATS.get() {
            let mut store = m.lock().unwrap();
            let duration_ms = (duration_secs.max(0.0) * 1000.0) as u32;
            let chars = text.chars().count() as u32;
            store.record(words, duration_ms, chars, unix_now(), text.to_string(), app);
            let _ = store.save(&stats_path());
        }
    }

    /// The most recent dictations for the Hub Home history list.
    pub fn history(limit: usize) -> Vec<koe_core::HistoryItem> {
        STATS
            .get()
            .map(|m| m.lock().unwrap().history(limit))
            .unwrap_or_default()
    }

    /// The dictionary entries for the Hub Dictionary screen (auto-learned flagged).
    pub fn dictionary_entries() -> Vec<DictEntryDto> {
        DICTIONARY
            .get()
            .map(|m| {
                m.lock()
                    .unwrap()
                    .entries
                    .iter()
                    .map(|e| DictEntryDto {
                        correct: e.correct.clone(),
                        mishears: e.mishears.clone(),
                        auto: matches!(e.source, koe_core::DictSource::Auto),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Add a manual dictionary entry and persist.
    pub fn dictionary_add(correct: String, mishears: Vec<String>) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            store.add(correct, mishears, koe_core::DictSource::Manual);
            let _ = store.save(&dict_path());
        }
    }

    /// Remove a dictionary entry by spelling and persist.
    pub fn dictionary_remove(correct: &str) {
        if let Some(m) = DICTIONARY.get() {
            let mut store = m.lock().unwrap();
            if store.remove(correct) {
                let _ = store.save(&dict_path());
            }
        }
    }

    /// Aggregated stats for the Hub. `tz_offset_minutes` is the UI's
    /// `Date.getTimezoneOffset()` so day math matches the user's local clock.
    pub fn stats_summary(tz_offset_minutes: i32) -> koe_core::StatsSummary {
        STATS
            .get()
            .map(|m| m.lock().unwrap().summary(tz_offset_minutes, unix_now()))
            .unwrap_or_else(|| {
                koe_core::StatsStore::default().summary(tz_offset_minutes, unix_now())
            })
    }

    /// A snapshot of the current settings.
    pub fn current_settings() -> koe_core::Settings {
        SETTINGS
            .get()
            .map(|m| m.lock().unwrap().clone())
            .unwrap_or_default()
    }
    /// Apply and persist new settings.
    pub fn update_settings(new: koe_core::Settings) {
        let _ = new.save(&settings_path());
        if let Some(m) = SETTINGS.get() {
            *m.lock().unwrap() = new;
        }
    }

    /// Clean a raw transcript per the current settings (mode + level), feeding in the
    /// dictionary vocabulary relevant to this utterance. Falls back to raw whenever
    /// cleanup is off, the provider is unavailable, it errors, or the gates reject it.
    fn clean_transcript(raw: &str) -> String {
        let settings = current_settings();
        let level = settings.cleanup_level;
        if matches!(settings.cleanup_mode, CleanupMode::Raw) || level.bypasses_llm() {
            return raw.to_string();
        }
        // Turn explicit spoken layout cues ("new line", "new paragraph") into break
        // markers up front — the model passes an opaque marker through reliably but
        // mangles the literal cue words. The model sees `raw` (with markers); the gate
        // and any raw fallback use `raw_out` (markers restored to real breaks) so we
        // never paste a "[[NL]]" token or lose an explicit break.
        let raw_norm = koe_core::cleanup::pre_normalize_layout(raw);
        let raw = raw_norm.as_str();
        let raw_out = koe_core::cleanup::post_process(&raw_norm);
        let vocab = DICTIONARY
            .get()
            .map(|d| d.lock().unwrap().prefilter(raw, 15))
            .unwrap_or_default();
        let app_bundle_id = TARGET_APP.get().and_then(|m| m.lock().unwrap().clone());
        if let Some(app) = app_bundle_id.as_deref() {
            eprintln!("[koe] cleanup target app: {app}");
        }
        let ctx = CleanupContext {
            level,
            vocab,
            app_bundle_id,
            ..Default::default()
        };
        // Run the on-device model with the same prompt + per-app formatting.
        let run_local = || -> Option<anyhow::Result<String>> {
            LOCAL.get().and_then(|m| {
                m.lock().unwrap().as_mut().map(|w| {
                    // System prompt + few-shot demonstration turns + the transcript,
                    // so the on-device model actually produces newlines/lists and
                    // resolves self-corrections instead of just being told to.
                    let messages = koe_core::cleanup::build_messages(raw, &ctx);
                    w.cleanup(&messages)
                })
            })
        };
        // Cleanup only ever runs on-device; this build has no cloud providers.
        let result: Option<anyhow::Result<String>> = match settings.cleanup_mode {
            CleanupMode::Local => run_local(),
            CleanupMode::Raw => None,
        };
        match result {
            Some(Ok(cleaned)) => {
                // Deterministic safety net: convert any leftover spoken layout cue the
                // model missed into real line breaks, strip stray code fences, cap blank
                // lines. Guarantees no "new line"/"new paragraph" word reaches the cursor.
                let cleaned = koe_core::cleanup::post_process(&cleaned);
                if koe_core::cleanup::evaluate_gates(&raw_out, &cleaned, level).passed() {
                    cleaned
                } else {
                    eprintln!("[koe] cleanup gate rejected the edit — pasting raw");
                    raw_out
                }
            }
            Some(Err(e)) => {
                eprintln!("[koe] cleanup failed ({e}) — pasting raw");
                raw_out
            }
            None => {
                eprintln!("[koe] local cleanup model unavailable — pasting raw");
                raw_out
            }
        }
    }

    fn now_ms() -> u64 {
        CLOCK.get().map(|c| c.elapsed().as_millis() as u64).unwrap_or(0)
    }

    fn bar_name(b: BarState) -> &'static str {
        match b {
            BarState::Idle => "idle",
            BarState::Recording => "recording",
            BarState::Locked => "locked",
            BarState::Transcribing => "transcribing",
            BarState::Done => "done",
            BarState::Cancelled => "cancelled",
            BarState::Error => "error",
        }
    }

    fn emit_bar(app: &AppHandle, state: &'static str) {
        eprintln!("[koe] pill -> {state}");
        let _ = app.emit_to(OVERLAY_LABEL, "koe://flowbar/state", BarPayload { state });
    }

    /// Feed one input into the shared state machine and enact its actions.
    fn handle_input(input: Input) {
        let (Some(app), Some(machine)) = (APP.get(), MACHINE.get()) else {
            return;
        };
        let actions = {
            let mut m = machine.lock().unwrap();
            m.step(input)
        };
        for action in actions {
            apply_action(app, action);
        }
    }

    fn apply_action(app: &AppHandle, action: Action) {
        match action {
            Action::ShowBar(bar) => {
                emit_bar(app, bar_name(bar));
                // Let the "done" tick linger briefly before returning to idle.
                if bar == BarState::Done {
                    let app2 = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(500));
                        emit_bar(&app2, "idle");
                    });
                }
            }
            // Start the microphone; stream real RMS bars to the pill waveform.
            // Runs off the tap thread so the mic-permission prompt can't stall keys.
            Action::StartCapture { .. } => {
                let app_thread = app.clone();
                std::thread::spawn(move || {
                    let app_cb = app_thread.clone();
                    match koe_audio::start(move |bars| {
                        let _ = app_cb.emit_to(
                            OVERLAY_LABEL,
                            "koe://audio/waveform",
                            WavePayload { bars: bars.to_vec() },
                        );
                    }) {
                        Ok(handle) => {
                            *CAPTURE.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(handle);
                        }
                        Err(e) => eprintln!("[koe] mic capture failed to start: {e}"),
                    }
                });
            }
            // Stop the mic, transcribe the buffered audio, and advance the machine.
            Action::StopCaptureAndFinalize { session } => {
                let app2 = app.clone();
                let handle = CAPTURE.get().and_then(|slot| slot.lock().unwrap().take());
                std::thread::spawn(move || {
                    // Whatever happens, return the pill to idle (done -> idle).
                    let finish =
                        || handle_input(Input::Pipeline(PipelineEvent::Committed { session }));
                    let Some(res) = handle.and_then(|h| h.stop()) else {
                        eprintln!("[koe] no audio captured");
                        finish();
                        return;
                    };
                    let peak = res.samples.iter().fold(0f32, |m, &s| m.max(s.abs()));
                    eprintln!(
                        "[koe] captured {} samples @ {} Hz (~{:.2}s), peak {:.4}",
                        res.samples.len(),
                        res.sample_rate,
                        res.duration_secs(),
                        peak
                    );
                    // Below ~600ms is very likely an accidental brief tap (the SPEC's
                    // own single-tap-no-op gate), so don't alarm the user over it —
                    // only surface a loud diagnostic for holds long enough to be a
                    // real, intentional dictation attempt.
                    let was_real_attempt = res.duration_secs() >= 0.6;
                    if peak < 0.005 {
                        eprintln!(
                            "[koe] ⚠ audio is silent — the mic isn't being captured. Grant \
                             Microphone access to your terminal (System Settings → Privacy & \
                             Security → Microphone), then fully quit + reopen it and rerun."
                        );
                        if was_real_attempt {
                            crate::diag::report(
                                &app2,
                                koe_core::InjectionFailure::NoAudioCaptured,
                            );
                        }
                        finish();
                        return;
                    }
                    let Some(asr) = ASR.get().cloned() else {
                        eprintln!("[koe] ASR not ready (model still loading or missing)");
                        if was_real_attempt && ASR_MODEL_MISSING.load(Ordering::SeqCst) {
                            crate::diag::report(&app2, koe_core::InjectionFailure::AsrUnavailable);
                        }
                        finish();
                        return;
                    };
                    let pcm = koe_audio::resample_to_16k(&res.samples, res.sample_rate);
                    match asr.transcribe(&pcm) {
                        Ok(t) => {
                            let raw = t.text;
                            // Never log the transcript itself: dictations can be
                            // confidential, and stderr ends up in system logs.
                            // Clean the transcript on-device, then paste.
                            let text = clean_transcript(&raw);
                            if !text.is_empty() {
                                if let Err(e) = crate::paste::paste_text(&text) {
                                    eprintln!("[koe] paste failed: {e}");
                                    // Distinguish the two real causes: Accessibility was
                                    // never (or no longer) granted, vs. everything else
                                    // (clipboard contention, etc.) — `is_trusted()` is the
                                    // authoritative check, cheaper and more precise than
                                    // matching on the error string.
                                    let failure = if !crate::paste::is_trusted() {
                                        koe_core::InjectionFailure::AccessibilityNotGranted
                                    } else {
                                        koe_core::InjectionFailure::ClipboardUnavailable
                                    };
                                    crate::diag::report(&app2, failure);
                                } else {
                                    crate::diag::clear_last_error();
                                }
                                // Log words + speaking time for the Hub stats (WPM, streak…).
                                record_dictation(&text, res.duration_secs());
                            } else if was_real_attempt {
                                crate::diag::report(&app2, koe_core::InjectionFailure::EmptyTranscript);
                            }
                            let _ = app2.emit_to(
                                OVERLAY_LABEL,
                                "koe://transcript",
                                TranscriptPayload { text },
                            );
                        }
                        Err(e) => {
                            eprintln!("[koe] ASR error: {e}");
                            if was_real_attempt {
                                crate::diag::report(&app2, koe_core::InjectionFailure::AsrUnavailable);
                            }
                        }
                    }
                    finish();
                });
            }
            Action::DiscardCapture { .. } => {
                if let Some(slot) = CAPTURE.get() {
                    if let Some(handle) = slot.lock().unwrap().take() {
                        let _ = handle.stop();
                    }
                }
            }
            // The ASR path (StopCaptureAndFinalize) now drives pipeline completion.
            Action::RunPipeline { .. } => {}
            // PlayPing / WarnSessionCap: no-ops for now.
            _ => {}
        }
    }

    extern "C" fn tap_callback(
        _proxy: CGEventTapProxy,
        etype: u32,
        event: CGEventRef,
        _info: *mut c_void,
    ) -> CGEventRef {
        if etype == K_CG_TAP_DISABLED_BY_TIMEOUT || etype == K_CG_TAP_DISABLED_BY_USER_INPUT {
            let port = TAP_PORT.load(Ordering::SeqCst);
            if !port.is_null() {
                unsafe { CGEventTapEnable(port, true) };
            }
            return event;
        }
        if etype == K_CG_EVENT_FLAGS_CHANGED {
            let keycode =
                unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) };
            if keycode == KEYCODE_FN {
                let flags = unsafe { CGEventGetFlags(event) };
                let down = (flags & FLAG_SECONDARY_FN) != 0;
                let was_down = FN_IS_DOWN.swap(down, Ordering::SeqCst);
                let at_ms = now_ms();
                if down && !was_down {
                    eprintln!("[koe] Fn DOWN");
                    // Snapshot the paste target now, while the user's app is focused.
                    let target = crate::appctx::frontmost_bundle_id();
                    *TARGET_APP.get_or_init(|| Mutex::new(None)).lock().unwrap() = target;
                    handle_input(Input::Trigger(TriggerToken::Down {
                        binding: BindingId::PushToTalk,
                        at_ms,
                    }));
                } else if !down && was_down {
                    eprintln!("[koe] Fn UP");
                    handle_input(Input::Trigger(TriggerToken::Up {
                        binding: BindingId::PushToTalk,
                        at_ms,
                    }));
                }
            }
        }
        event
    }

    /// Stop and finalize the current recording — the pill's red Stop button.
    /// Drives the same state machine the Fn key does, so it works in either
    /// mode.
    pub fn stop_dictation() {
        handle_input(Input::Trigger(TriggerToken::Stop { at_ms: now_ms() }));
    }

    /// Discard the current recording — the pill's ✕ button. Same path Esc would
    /// take, if Esc were wired.
    pub fn cancel_dictation() {
        handle_input(Input::Trigger(TriggerToken::Cancel { at_ms: now_ms() }));
    }

    /// Toggle HANDS-FREE (locked) dictation — the customizable global hotkey
    /// (default Cmd+Shift+Space) fires this. The state machine treats a
    /// `HandsFree` press as a toggle: from idle it starts a locked session that
    /// keeps recording with no key held, and while locked it finalizes.
    pub fn trigger_hands_free() {
        handle_input(Input::Trigger(TriggerToken::Down {
            binding: BindingId::HandsFree,
            at_ms: now_ms(),
        }));
    }

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);
        let _ = MACHINE.set(Mutex::new(StateMachine::new()));
        let _ = CLOCK.set(Instant::now());

        // Load the speech-to-text model off the main thread. Only a model whose
        // SHA-256 matches models/manifest.json is loaded; the most accurate
        // verified one present wins.
        std::thread::spawn(|| {
            let preferred = koe_core::Settings::load(&settings_path()).speech_model;
            let Some(found) = crate::models::choose(ModelKind::Whisper, preferred.as_deref(), "[koe]") else {
                ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                return;
            };
            let path = found.path;
            match koe_asr::WhisperEngine::load(&path) {
                Ok(engine) => {
                    let _ = ASR.set(Arc::new(engine));
                    eprintln!("[koe] ASR model loaded — ready to transcribe");
                }
                Err(e) => {
                    eprintln!("[koe] ASR model load failed: {e}");
                    ASR_MODEL_MISSING.store(true, Ordering::SeqCst);
                }
            }
        });

        // Load settings + dictionary.
        let settings = koe_core::Settings::load(&settings_path());
        let dict = koe_core::DictionaryStore::load(&dict_path());
        eprintln!(
            "[koe] cleanup mode: {:?}, level: {:?}",
            settings.cleanup_mode, settings.cleanup_level
        );
        let _ = SETTINGS.set(Mutex::new(settings));
        let _ = DICTIONARY.set(Mutex::new(dict));
        let _ = STATS.set(Mutex::new(koe_core::StatsStore::load(&stats_path())));

        // Start the local cleanup worker in the background (model load takes a few
        // seconds; the first local cleanup waits for it, subsequent ones are fast).
        std::thread::spawn(|| {
            let worker = crate::local_llm::spawn_default(current_settings().cleanup_model.as_deref());
            let _ = LOCAL.set(Mutex::new(worker));
        });

        // Accessibility is the ONE permission that makes the Fn CGEventTap global AND
        // lets us post the Cmd+V paste into other apps. Without it, a keyboard tap is
        // silently limited to frontmost-only — the exact bug. Prompt for it up front.
        if crate::paste::is_trusted() {
            eprintln!("[koe] Accessibility granted — Fn works in every app, paste enabled");
        } else {
            eprintln!(
                "[koe] ⚠ Accessibility NOT granted — Fn only works while Koe is \
                 frontmost and paste is disabled. Prompting; grant Koe under System \
                 Settings → Privacy & Security → Accessibility (no relaunch needed)."
            );
            crate::paste::prompt_accessibility();
        }
        // Input Monitoring is NOT the gate for a CGEventTap — kept only as diagnostics.
        eprintln!(
            "[koe] (info) Input Monitoring: {}",
            crate::paste::input_monitoring_granted()
        );

        // Periodic tick drives the double-tap timeout / session cap.
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(100));
            handle_input(Input::Tick { now_ms: now_ms() });
        });

        // The event tap runs on a thread with its own CFRunLoop. CRITICAL: create it
        // ONLY after the process is trusted for Accessibility. macOS fixes a keyboard
        // tap's privilege at CGEventTapCreate time — a tap born untrusted is
        // permanently frontmost-only and is NOT upgraded when the grant later arrives.
        // Polling here also means the Fn key starts working the moment the user grants
        // Accessibility, without a relaunch.
        std::thread::spawn(|| {
            while !crate::paste::is_trusted() {
                std::thread::sleep(Duration::from_millis(500));
            }
            eprintln!("[koe] Accessibility present — creating global Fn tap");
            // Bug fix: this used to try CGEventTapCreate exactly once and, if it
            // came back null despite Accessibility being granted (the real-world
            // stale-TCC-entry case this app's own comments already knew about),
            // give up FOREVER with only an eprintln — the Fn key would then do
            // nothing for the rest of the run, indistinguishable from "text isn't
            // typed" to the user, with zero visible explanation. Now: report it
            // loudly once, and keep retrying — toggling the Accessibility entry
            // off/on in System Settings, or removing and re-adding it, fixes the
            // stale grant without requiring a relaunch, and this way that fix is
            // picked up automatically.
            let mut reported = false;
            let port = loop {
                let port = unsafe {
                    CGEventTapCreate(
                        K_CG_SESSION_EVENT_TAP,
                        K_CG_HEAD_INSERT,
                        K_CG_TAP_OPTION_LISTEN_ONLY,
                        EVENTS_OF_INTEREST,
                        tap_callback,
                        null_mut(),
                    )
                };
                if !port.is_null() {
                    break port;
                }
                eprintln!(
                    "[koe] Fn tap null despite Accessibility — likely a stale TCC entry from \
                     an earlier build. Run: tccutil reset Accessibility com.koe.dictation, \
                     or toggle Koe off/on under System Settings → Privacy & Security → \
                     Accessibility. Retrying…"
                );
                if !reported {
                    if let Some(app) = APP.get() {
                        crate::diag::report(app, koe_core::InjectionFailure::HotkeyTapFailed);
                    }
                    reported = true;
                }
                std::thread::sleep(Duration::from_secs(5));
            };
            if reported {
                eprintln!("[koe] Fn tap recovered — the key is live now.");
                crate::diag::clear_last_error();
            }
            TAP_PORT.store(port, Ordering::SeqCst);
            unsafe {
                let source = CFMachPortCreateRunLoopSource(null(), port, 0);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
                CGEventTapEnable(port, true);
                CFRunLoopRun();
            }
        });
    }
}

#[cfg(target_os = "macos")]
pub use imp::{
    cancel_dictation, current_settings, dictionary_add, dictionary_entries,
    dictionary_remove, history, install, stats_summary, stop_dictation,
    trigger_hands_free, update_settings,
};

// Windows uses the real (but unverified) platform layer in `crate::win`.
#[cfg(target_os = "windows")]
pub use crate::win::{
    cancel_dictation, current_settings, dictionary_add, dictionary_entries,
    dictionary_remove, history, install, stats_summary, stop_dictation,
    trigger_hands_free, update_settings,
};

// Other platforms (Linux, etc.): inert stubs so the crate still builds.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod other {
    pub fn install(_app: tauri::AppHandle) {}
    pub fn current_settings() -> koe_core::Settings {
        koe_core::Settings::default()
    }
    pub fn update_settings(_new: koe_core::Settings) {}
    pub fn stats_summary(tz_offset_minutes: i32) -> koe_core::StatsSummary {
        koe_core::StatsStore::default().summary(tz_offset_minutes, 0)
    }
    pub fn history(_limit: usize) -> Vec<koe_core::HistoryItem> {
        Vec::new()
    }
    pub fn dictionary_entries() -> Vec<super::DictEntryDto> {
        Vec::new()
    }
    pub fn dictionary_add(_correct: String, _mishears: Vec<String>) {}
    pub fn dictionary_remove(_correct: &str) {}
    pub fn stop_dictation() {}
    pub fn cancel_dictation() {}
    pub fn trigger_hands_free() {}
}
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use other::{
    cancel_dictation, current_settings, dictionary_add, dictionary_entries,
    dictionary_remove, history, install, stats_summary, stop_dictation,
    trigger_hands_free, update_settings,
};
