//! Koe Tauri shell: the menu-bar tray item, the transparent always-on-top pill
//! overlay, the Hub window, and the commands the Hub calls. The dictation
//! pipeline itself (hotkey → audio → ASR → cleanup → paste) lives in `hotkey`
//! on macOS and `win` on Windows.

mod appctx;
mod diag;
mod hotkey;
mod local_llm;
mod models;
mod paste;
mod permissions;
#[cfg(target_os = "windows")]
mod win;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

const OVERLAY_LABEL: &str = "koe_bar";
const HUB_LABEL: &str = "main";

/// Anchor the overlay window bottom-center of its monitor.
fn position_overlay(w: &WebviewWindow) {
    // current_monitor() can be None before the window maps; fall back sensibly.
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.current_monitor().ok().flatten())
        .or_else(|| w.available_monitors().ok().and_then(|m| m.into_iter().next()));
    let Some(monitor) = monitor else {
        eprintln!("[koe] no monitor found — overlay stays at default position");
        return;
    };
    let scale = monitor.scale_factor();
    let msize = monitor.size();
    let mpos = monitor.position();
    let Ok(wsize) = w.outer_size() else { return };
    let inset = (40.0 * scale) as i32;
    let x = mpos.x + (msize.width as i32 - wsize.width as i32) / 2;
    let y = mpos.y + msize.height as i32 - wsize.height as i32 - inset;
    let _ = w.set_position(tauri::PhysicalPosition { x, y });
    eprintln!(
        "[koe] overlay placed: monitor {}x{} @({},{}) scale {:.1} -> window {}x{} @({},{})",
        msize.width, msize.height, mpos.x, mpos.y, scale, wsize.width, wsize.height, x, y
    );
}

fn build_overlay(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let overlay = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("KoeBar")
    // Tight window so it only catches clicks right around the pill, not a big
    // invisible box over the app behind it.
    .inner_size(300.0, 72.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .resizable(false)
    .visible(true)
    .build()?;
    position_overlay(&overlay);
    let _ = overlay.show();
    Ok(overlay)
}

fn build_hub(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, HUB_LABEL, WebviewUrl::App("index.html".into()))
        .title("Koe")
        .inner_size(1120.0, 760.0)
        .min_inner_size(900.0, 600.0)
        .visible(true)
        .build()
}

#[tauri::command]
fn get_settings() -> koe_core::Settings {
    hotkey::current_settings()
}

#[tauri::command]
fn set_settings(app: tauri::AppHandle, settings: koe_core::Settings) {
    hotkey::update_settings(settings);
    // The hands-free hotkey may have changed — re-register it from the new
    // settings so a customized combo takes effect without a relaunch.
    apply_hands_free_shortcut(&app);
}

/// Stop and finalize the current recording — the overlay pill's red Stop button.
#[tauri::command]
fn stop_dictation() {
    hotkey::stop_dictation();
}

/// Discard the current recording — the overlay pill's ✕ button.
#[tauri::command]
fn cancel_dictation() {
    hotkey::cancel_dictation();
}

/// Aggregated dictation stats for the Hub dashboard. `tz_offset_minutes` is the
/// browser's `Date.getTimezoneOffset()` so "today"/streak match the user's clock.
#[tauri::command]
fn get_stats(tz_offset_minutes: i32) -> koe_core::StatsSummary {
    hotkey::stats_summary(tz_offset_minutes)
}

/// Recent dictations for the Hub Home history list (newest first).
#[tauri::command]
fn get_history() -> Vec<koe_core::HistoryItem> {
    hotkey::history(200)
}

/// Dictionary entries for the Hub Dictionary screen.
#[tauri::command]
fn get_dictionary() -> Vec<hotkey::DictEntryDto> {
    hotkey::dictionary_entries()
}

/// Add a manual dictionary entry (word + optional known mishears).
#[tauri::command]
fn add_dictionary_entry(correct: String, mishears: Vec<String>) {
    hotkey::dictionary_add(correct, mishears);
}

/// Remove a dictionary entry by its spelling.
#[tauri::command]
fn remove_dictionary_entry(correct: String) {
    hotkey::dictionary_remove(&correct);
}

/// Permission + capability status shown in the Hub.
///
/// The permission half is a live read every time (see `permissions::snapshot`);
/// nothing here is remembered between calls. The Hub no longer has to ask for it
/// on a timer either — `permissions::watch` pushes the same shape at it on
/// `koe://permissions` the moment macOS changes its mind.
#[derive(Clone, Serialize)]
struct StatusReport {
    accessibility: bool,
    microphone: bool,
    input_monitoring: bool,
    microphone_grant: permissions::Grant,
    charged_to: Option<String>,
    microphone_hint: Option<String>,
}

#[tauri::command]
fn get_status() -> StatusReport {
    let p = permissions::snapshot();
    StatusReport {
        accessibility: p.accessibility,
        microphone: p.microphone,
        input_monitoring: p.input_monitoring,
        microphone_grant: p.microphone_grant,
        charged_to: p.charged_to,
        microphone_hint: p.microphone_hint,
    }
}

/// The most recent loud diagnostic (permission/injection failure), if any —
/// lets the Hub show what went wrong even if it was opened after the fact.
/// See `diag::report`, called from the dictation pipeline whenever text
/// fails to reach the cursor.
/// Every allowed model, with what's installed and what's loaded, for the Models page.
#[tauri::command]
fn get_models() -> models::ModelsReport {
    models::report()
}

/// Open Terminal downloading a tier or model with the bundled script.
#[tauri::command]
fn download_models(app: tauri::AppHandle, target: String) -> Result<(), String> {
    models::open_download(&app, &target)
}

/// Open a model's official page in the browser.
#[tauri::command]
fn open_model_card(file: String) -> Result<(), String> {
    models::open_card(&file)
}

/// Relaunch Koe, so a newly chosen model is loaded.
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn get_last_error() -> Option<diag::ErrorDto> {
    diag::last_error()
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}

/// Clear Koe's own entry for a privacy `service` so the next request starts
/// fresh. Every Koe build is a new app to macOS, and after an update System
/// Settings can keep showing the previous build's approval switched on even
/// though it no longer applies, with no way to fix it from the switch alone.
/// Only called when the permission is currently missing, so a working grant is
/// never touched.
#[cfg(target_os = "macos")]
fn reset_stale_grant(app: &tauri::AppHandle, service: &str) {
    let id = &app.config().identifier;
    let _ = std::process::Command::new("/usr/bin/tccutil").args(["reset", service, id]).status();
}

/// Request microphone access with AVFoundation so macOS registers this bundle in
/// Privacy & Security, then open the Microphone settings pane.
#[tauri::command]
fn request_microphone(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if !permissions::snapshot().microphone {
            reset_stale_grant(&app, "Microphone");
        }
        paste::request_microphone_access();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
    }
}

/// Request Accessibility — the permission that makes the Fn key work in every app and
/// lets us type into other apps. Fire the native prompt, then open the pane.
#[tauri::command]
fn request_accessibility(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if !paste::is_trusted() {
            reset_stale_grant(&app, "Accessibility");
        }
        let _ = paste::prompt_accessibility();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    }
}

/// Request Input Monitoring (needed for the Fn key to be seen in every app, not
/// just while Koe is frontmost): register + prompt, then open the pane.
#[tauri::command]
fn request_input_monitoring(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        if !paste::input_monitoring_granted() {
            reset_stale_grant(&app, "ListenEvent");
        }
        let _ = paste::request_input_monitoring();
        open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent");
    }
}

/// (Re)register the customizable hands-free global hotkey from the current
/// settings — press once to start hands-free dictation, again to stop. Called at
/// startup and whenever settings change. Best-effort: an unregisterable or empty
/// accelerator just leaves the hotkey off (Fn push-to-talk and double-tap-Fn
/// hands-free still work), never a crash.
fn apply_hands_free_shortcut(app: &tauri::AppHandle) {
    let accelerator = hotkey::current_settings().hands_free_hotkey;
    if let Err(e) = register_hands_free(app, &accelerator) {
        eprintln!("[koe] hands-free hotkey '{accelerator}' could not be registered: {e}");
    }
}

/// Make `accelerator` the one registered hands-free hotkey (empty = none).
fn register_hands_free(app: &tauri::AppHandle, accelerator: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();
    if accelerator.trim().is_empty() {
        return Ok(());
    }
    global_shortcut.register(accelerator).map_err(|e| e.to_string())
}

/// Change the hands-free (toggle) hotkey from Settings. The new combo is
/// registered before it is saved, so one that's invalid or already taken by
/// macOS or another app is reported back, and the previous shortcut keeps working.
#[tauri::command]
fn set_hands_free_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let mut settings = hotkey::current_settings();
    let previous = std::mem::replace(&mut settings.hands_free_hotkey, accelerator);
    if let Err(e) = register_hands_free(&app, &settings.hands_free_hotkey) {
        let _ = register_hands_free(&app, &previous);
        return Err(format!(
            "Couldn't use that shortcut ({e}). It may already belong to macOS or another app — try a different one."
        ));
    }
    hotkey::update_settings(settings);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            // The customizable hands-free hotkey lives here — the OS registers the
            // chord, so pressing it fires our handler AND is suppressed from the
            // focused app (a listen-only CGEvent tap could not consume a printable
            // key like Space). Only the hands-free shortcut is ever registered, so
            // any Pressed event is a hands-free toggle.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        hotkey::trigger_hands_free();
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_settings,
            set_settings,
            stop_dictation,
            cancel_dictation,
            get_stats,
            get_history,
            get_dictionary,
            add_dictionary_entry,
            remove_dictionary_entry,
            get_status,
            get_last_error,
            request_microphone,
            request_accessibility,
            request_input_monitoring,
            set_hands_free_hotkey,
            get_models,
            download_models,
            open_model_card,
            restart_app
        ])
        .setup(|app| {
            // Regular app: shows in the Dock with a normal, focusable main window.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            build_overlay(app)?;
            let hub = build_hub(app)?;
            let _ = hub.show();
            let _ = hub.set_focus();

            // Wire the Fn key to the pill via the real state machine.
            hotkey::install(app.handle().clone());

            // Register the customizable hands-free hotkey (default Cmd+Shift+Space).
            apply_hands_free_shortcut(app.handle());

            // Keep the permission rows honest without the Hub having to be awake
            // to ask. This is what makes the setup screen's promise ("turns green
            // the moment macOS applies it — no relaunch needed") actually true:
            // the Hub's own timer stops within seconds of its window going away,
            // and the reader is granting from System Settings precisely then.
            permissions::watch(app.handle().clone());

            let open = MenuItem::with_id(app, "open", "Open Koe", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Koe", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sep, &quit])?;

            // A monochrome template image, so macOS tints it for light and dark
            // menu bars like every other menu-bar item.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window(HUB_LABEL) {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            tray.build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Koe");
}
