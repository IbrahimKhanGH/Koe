// Typed wrappers over the Tauri command surface. In a plain browser (vite dev
// without the shell) the invoke import fails and we fall back to defaults so the
// Hub still renders for iteration.

export type CleanupMode = "raw" | "local";
export type CleanupLevel = "none" | "light" | "medium" | "high";

export interface Settings {
  cleanup_mode: CleanupMode;
  cleanup_level: CleanupLevel;
  sound_on_start: boolean;
  // The binding that toggles hands-free (locked) dictation — press once to start
  // talking with nothing held, again to stop. A keyboard accelerator (default
  // "CmdOrCtrl+Shift+Space") or a mouse button ("Mouse4"). Empty disables it.
  hands_free_hotkey: string;
  // The binding you hold to talk. Same forms, plus "Fn" (the default).
  hold_hotkey: string;
  // The models chosen on the Models page (file names from models/manifest.json);
  // null means automatic: the best one installed.
  speech_model: string | null;
  cleanup_model: string | null;
}

// Mirrors `permissions::Grant` in src-tauri. A bare boolean couldn't tell
// "nobody has asked yet" from "asked and turned down" — two states with
// completely different instructions for the reader.
export type Grant = "granted" | "not_asked" | "refused";

export interface Status {
  accessibility: boolean;
  microphone: boolean;
  input_monitoring: boolean;
  microphone_grant: Grant;
  // The app macOS is actually judging our microphone request as, when that
  // isn't us (a terminal that launched us, say). Null in the normal case.
  charged_to: string | null;
  // One sentence saying why the microphone row can't go green, when there's
  // something the reader couldn't otherwise have known. Null when there isn't.
  microphone_hint: string | null;
}

// What the Hub falls back to before the first read lands (and in a plain
// browser preview, where there's no shell to ask).
export const UNKNOWN_STATUS: Status = {
  accessibility: false,
  microphone: false,
  input_monitoring: false,
  microphone_grant: "not_asked",
  charged_to: null,
  microphone_hint: null,
};

export interface StatsSummary {
  total_words: number;
  total_sessions: number;
  total_speaking_secs: number;
  avg_wpm: number;
  best_wpm: number;
  words_today: number;
  wpm_today: number;
  day_streak: number;
  time_saved_secs: number;
  last7_words: number[];
}

export const EMPTY_STATS: StatsSummary = {
  total_words: 0,
  total_sessions: 0,
  total_speaking_secs: 0,
  avg_wpm: 0,
  best_wpm: 0,
  words_today: 0,
  wpm_today: 0,
  day_streak: 0,
  time_saved_secs: 0,
  last7_words: [0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_SETTINGS: Settings = {
  cleanup_mode: "local",
  cleanup_level: "light",
  sound_on_start: true,
  hands_free_hotkey: "CmdOrCtrl+Shift+Space",
  hold_hotkey: "Fn",
  speech_model: null,
  cleanup_model: null,
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function getSettings(): Promise<Settings> {
  try {
    return await invoke<Settings>("get_settings");
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export type HotkeyKind = "hold" | "toggle";

/** Change the hold or toggle binding. Resolves to null once it's live, or to a
 * message saying why it can't be used (the old binding keeps working). */
export async function setHotkey(which: HotkeyKind, binding: string): Promise<string | null> {
  try {
    await invoke<void>("set_hotkey", { which, binding });
    return null;
  } catch (e) {
    return typeof e === "string" ? e : null; /* browser preview: no shell */
  }
}

/** Start recording a new binding: the current shortcuts are released so their
 * keys can be pressed, and the next mouse button (middle or side) is reported
 * to `onBindingCaptured` instead of dictating. */
export async function beginBindingCapture(): Promise<void> {
  try {
    await invoke<void>("begin_binding_capture");
  } catch {
    /* browser preview — no-op */
  }
}

/** Stop recording: the saved bindings go back in force. */
export async function endBindingCapture(): Promise<void> {
  try {
    await invoke<void>("end_binding_capture");
  } catch {
    /* browser preview — no-op */
  }
}

/** A mouse button pressed while recording, as a binding string ("Mouse4",
 * "Ctrl+Mouse5"). Mouse buttons are read natively because the web view can't
 * tell the side buttons apart. */
export async function onBindingCaptured(cb: (binding: string) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<{ binding: string }>("koe://binding/captured", (e) => cb(e.payload.binding));
  } catch {
    return () => {};
  }
}

export async function setSettings(settings: Settings): Promise<void> {
  try {
    await invoke<void>("set_settings", { settings });
  } catch {
    /* browser preview — no-op */
  }
}

export async function getStatus(): Promise<Status> {
  try {
    return await invoke<Status>("get_status");
  } catch {
    return UNKNOWN_STATUS;
  }
}

// The permission heartbeat, pushed from Rust (`permissions::watch`) the moment
// macOS changes its mind. This is what makes the setup screen's promise —
// "turns green the moment macOS applies it, no relaunch needed" — true even
// when the Hub's own timer isn't running, which is exactly when the reader is
// off in System Settings doing the granting. Payload is the permission half of
// `Status`; the key fields ride along unchanged.
export type Permissions = Pick<
  Status,
  | "accessibility"
  | "microphone"
  | "input_monitoring"
  | "microphone_grant"
  | "charged_to"
  | "microphone_hint"
>;

export async function onPermissions(cb: (p: Permissions) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<Permissions>("koe://permissions", (e) => cb(e.payload));
  } catch {
    return () => {};
  }
}

// The most recent loud diagnostic from the dictation pipeline (permission
// missing, hotkey tap dead, paste failed, empty transcript, …). Mirrors
// `diag::ErrorDto` in src-tauri/src/diag.rs.
export interface LastError {
  headline: string;
  detail: string;
}

export async function getLastError(): Promise<LastError | null> {
  try {
    return await invoke<LastError | null>("get_last_error");
  } catch {
    return null;
  }
}

export async function getStats(): Promise<StatsSummary> {
  try {
    const tz = new Date().getTimezoneOffset(); // minutes to add to local -> UTC
    return await invoke<StatsSummary>("get_stats", { tzOffsetMinutes: tz });
  } catch {
    return EMPTY_STATS;
  }
}

export async function requestMicrophone(): Promise<void> {
  try {
    await invoke<void>("request_microphone");
  } catch {
    /* browser preview */
  }
}

export async function requestAccessibility(): Promise<void> {
  try {
    await invoke<void>("request_accessibility");
  } catch {
    /* browser preview */
  }
}

export async function requestInputMonitoring(): Promise<void> {
  try {
    await invoke<void>("request_input_monitoring");
  } catch {
    /* browser preview */
  }
}

// ── History ────────────────────────────────────────────────────────────────
export interface HistoryItem {
  ts_unix: number;
  text: string;
  app: string | null;
  words: number;
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    return await invoke<HistoryItem[]>("get_history");
  } catch {
    return [];
  }
}

// ── Dictionary ───────────────────────────────────────────────────────────────
export interface DictEntry {
  correct: string;
  mishears: string[];
  auto: boolean;
}

export async function getDictionary(): Promise<DictEntry[]> {
  try {
    return await invoke<DictEntry[]>("get_dictionary");
  } catch {
    return [];
  }
}

export async function addDictionaryEntry(correct: string, mishears: string[]): Promise<void> {
  try {
    await invoke<void>("add_dictionary_entry", { correct, mishears });
  } catch {
    /* browser preview — no-op */
  }
}

export async function removeDictionaryEntry(correct: string): Promise<void> {
  try {
    await invoke<void>("remove_dictionary_entry", { correct });
  } catch {
    /* browser preview — no-op */
  }
}


// ── Models ───────────────────────────────────────────────────────────────────
// Mirrors `models::ModelInfo` / `ModelsReport` in src-tauri.
export type ModelKind = "whisper" | "cleanup";
export type Tier = "compact" | "balanced" | "max";

export interface ModelInfo {
  kind: ModelKind;
  file: string;
  maker: string;
  license: string;
  card: string;
  published_by: string;
  label: string;
  note: string;
  size: number;
  ram_gb: number;
  tiers: Tier[];
  hybrid: boolean;
  installed: boolean;
  active: boolean;
  failed_check: boolean;
  /** Bytes on disk so far: the whole file once installed, else the download in progress. */
  downloaded: number;
}

export interface ModelsReport {
  dir: string;
  /** This Mac's memory, for recommending a tier (0 if unknown). */
  memory_gb: number;
  models: ModelInfo[];
}

export const NO_MODELS: ModelsReport = { dir: "", memory_gb: 0, models: [] };

export async function getModels(): Promise<ModelsReport> {
  try {
    return await invoke<ModelsReport>("get_models");
  } catch {
    return NO_MODELS;
  }
}

/** Open Terminal downloading a tier ("compact" | "balanced" | "max") or one model
 * file with the script bundled in Koe. Resolves to null, or why it couldn't. */
export async function downloadModels(target: string): Promise<string | null> {
  try {
    await invoke<void>("download_models", { target });
    return null;
  } catch (e) {
    return typeof e === "string" ? e : null;
  }
}

/** Copy a past dictation to the clipboard (this Mac only, hidden from clipboard managers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await invoke<void>("copy_text", { text });
    return true;
  } catch {
    return false;
  }
}

/** Open a model's official page (from the manifest) in the browser. */
export async function openModelCard(file: string): Promise<void> {
  try {
    await invoke<void>("open_model_card", { file });
  } catch {
    /* browser preview */
  }
}

export async function restartApp(): Promise<void> {
  try {
    await invoke<void>("restart_app");
  } catch {
    /* browser preview */
  }
}
