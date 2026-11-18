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
    let hub = WebviewWindowBuilder::new(app, HUB_LABEL, WebviewUrl::App("index.html".into()))
        .title("Koe")
        .inner_size(1120.0, 760.0)
        .min_inner_size(900.0, 600.0)
        .visible(true)
        .build()?;
    // The close button hides the Hub instead of destroying it. Koe keeps running
    // in the menu bar either way, and a destroyed Hub could never be brought back
    // (the tray's "Open Koe" and the Dock icon both look for this window), which
    // left quitting — and losing the in-memory history — as the only way back in.
    let h = hub.clone();
    hub.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = h.hide();
        }
    });
    Ok(hub)
}

/// Bring the Hub back to the front (tray "Open Koe", clicking the Dock icon).
fn show_hub(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(HUB_LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn get_settings() -> koe_core::Settings {
    hotkey::current_settings()
}

#[tauri::command]
fn set_settings(app: tauri::AppHandle, settings: koe_core::Settings) {
    hotkey::update_settings(settings);
    // The hold or toggle binding may have changed — re-register from the new
    // settings so it takes effect without a relaunch.
    apply_bindings(&app);
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

/// Copy a past dictation to the clipboard, privately (Home history's copy button).
#[tauri::command]
fn copy_text(text: String) {
    paste::copy_private(&text);
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

/// The global-shortcut ids of the (hold, toggle) bindings when they are
/// keyboard shortcuts, so the plugin's handler can tell which one fired. A
/// binding on Fn or a mouse button is `None` here: `hotkey` watches those.
static KEY_BINDING_IDS: std::sync::Mutex<(Option<u32>, Option<u32>)> =
    std::sync::Mutex::new((None, None));

fn parse_shortcut(accelerator: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, String> {
    accelerator
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| e.to_string())
}

/// (Re)register the hold and toggle bindings from the current settings. Called
/// at startup and whenever settings change. Best-effort: a binding that can't
/// be registered is left off, never a crash.
fn apply_bindings(app: &tauri::AppHandle) {
    let settings = hotkey::current_settings();
    if let Err(e) = register_bindings(app, &settings.hold_hotkey, &settings.hands_free_hotkey) {
        eprintln!("[koe] a dictation shortcut could not be registered: {e}");
    }
}

/// Make `hold` and `toggle` the registered keyboard shortcuts. Only bindings
/// that are keyboard shortcuts are registered here; Fn and mouse buttons are
/// read from settings by the event taps in `hotkey`.
fn register_bindings(app: &tauri::AppHandle, hold: &str, toggle: &str) -> Result<(), String> {
    use koe_core::Binding;
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let global_shortcut = app.global_shortcut();
    let _ = global_shortcut.unregister_all();
    let mut ids = KEY_BINDING_IDS.lock().unwrap();
    *ids = (None, None);
    if let Binding::Keys(accelerator) = Binding::parse(hold) {
        let shortcut = parse_shortcut(&accelerator)?;
        global_shortcut.register(shortcut).map_err(|e| e.to_string())?;
        ids.0 = Some(shortcut.id());
    }
    if let Binding::Keys(accelerator) = Binding::parse(toggle) {
        let shortcut = parse_shortcut(&accelerator)?;
        global_shortcut.register(shortcut).map_err(|e| e.to_string())?;
        ids.1 = Some(shortcut.id());
    }
    Ok(())
}

/// Whether two bindings are the same trigger. Keyboard shortcuts are compared
/// as parsed, so "Cmd+Shift+Space" and "Shift+CmdOrCtrl+Space" count as equal.
fn same_binding(a: &str, b: &str) -> bool {
    use koe_core::Binding;
    match (Binding::parse(a), Binding::parse(b)) {
        (Binding::Off, _) | (_, Binding::Off) => false,
        (Binding::Keys(a), Binding::Keys(b)) => match (parse_shortcut(&a), parse_shortcut(&b)) {
            (Ok(a), Ok(b)) => a.id() == b.id(),
            _ => false,
        },
        (a, b) => a == b,
    }
}

/// Change the hold (`which` = "hold") or toggle ("toggle") binding from
/// Settings. `binding` is a keyboard shortcut, a mouse button, "Fn", or empty
/// for off. It is registered before it is saved, so one that's invalid or
/// already taken by macOS or another app is reported back, and the previous
/// bindings keep working.
#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, which: String, binding: String) -> Result<(), String> {
    let previous = hotkey::current_settings();
    let mut settings = previous.clone();
    let binding = binding.trim().to_string();
    match which.as_str() {
        "hold" => settings.hold_hotkey = binding,
        "toggle" => settings.hands_free_hotkey = binding,
        other => return Err(format!("Unknown binding '{other}'.")),
    }
    if same_binding(&settings.hold_hotkey, &settings.hands_free_hotkey) {
        let other = if which == "hold" { "toggle" } else { "hold" };
        return Err(format!("That's already your {other} binding. Pick a different one."));
    }
    if let Err(e) = register_bindings(&app, &settings.hold_hotkey, &settings.hands_free_hotkey) {
        let _ = register_bindings(&app, &previous.hold_hotkey, &previous.hands_free_hotkey);
        return Err(format!(
            "Couldn't use that shortcut ({e}). It may already belong to macOS or another app — try a different one."
        ));
    }
    hotkey::update_settings(settings);
    Ok(())
}

/// Settings started recording a new binding. The current keyboard shortcuts are
/// released so the recorder can see those keys, and the next mouse button
/// pressed is reported to the Hub (`koe://binding/captured`) instead of acted on.
#[tauri::command]
fn begin_binding_capture(app: tauri::AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app.global_shortcut().unregister_all();
    *KEY_BINDING_IDS.lock().unwrap() = (None, None);
    hotkey::set_binding_capture(true);
}

/// Settings stopped recording: put the saved bindings back in force.
#[tauri::command]
fn end_binding_capture(app: tauri::AppHandle) {
    hotkey::set_binding_capture(false);
    apply_bindings(&app);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            // Hold and toggle bindings that are keyboard shortcuts live here — the
            // OS registers the chord, so pressing it fires our handler AND is
            // suppressed from the focused app (a listen-only CGEvent tap could not
            // consume a printable key like Space). The hold binding starts on
            // press and finishes on release; the toggle acts on press only.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|_app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    let (hold, toggle) = *KEY_BINDING_IDS.lock().unwrap();
                    let id = Some(shortcut.id());
                    if id == hold {
                        match event.state() {
                            ShortcutState::Pressed => hotkey::hold_pressed(),
                            ShortcutState::Released => hotkey::hold_released(),
                        }
                    } else if id == toggle && event.state() == ShortcutState::Pressed {
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
            set_hotkey,
            begin_binding_capture,
            end_binding_capture,
            get_models,
            download_models,
            open_model_card,
            copy_text,
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

            // Wire the dictation bindings to the pill via the real state machine.
            hotkey::install(app.handle().clone());

            // Register the keyboard-shortcut bindings (toggle defaults to
            // Cmd+Shift+Space; hold defaults to Fn, which needs no registering).
            apply_bindings(app.handle());

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
                    "open" => show_hub(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            tray.build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Koe")
        .run(|app, event| {
            // Clicking Koe in the Dock after closing its window reopens the Hub.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_hub(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
