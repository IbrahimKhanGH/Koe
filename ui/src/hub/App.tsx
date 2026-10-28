import { useCallback, useEffect, useRef, useState } from "react";
import { palette } from "../tokens/values";
import { theme } from "./theme";
import { Onboarding } from "./Onboarding";
import { Sidebar, type Page } from "./Sidebar";
import { Home } from "./Home";
import { DictionaryPane } from "./DictionaryPane";
import { ModelsPane } from "./ModelsPane";
import { SettingsPane } from "./SettingsPane";
import { Help } from "./Help";
import { PrivacyPane } from "./PrivacyPane";
import { Icon } from "./icons";
import { Button, Eyebrow } from "./ui";
import { prettyAccelerator } from "./format";
import {
  getSettings,
  setSettings,
  getStatus,
  getModels,
  getLastError,
  onPermissions,
  requestAccessibility,
  requestMicrophone,
  type ModelsReport,
  type Settings,
  type Status,
  type LastError,
  DEFAULT_SETTINGS,
  UNKNOWN_STATUS,
} from "./api";

// A dismissible warning strip shown above the Hub content whenever something
// is stopping dictation from reaching the cursor: a permission that lapsed
// after onboarding (e.g. a rebuild invalidated the macOS Accessibility grant),
// or the last diagnostic reported by the dictation pipeline (`diag::report`).
function ErrorBanner({
  headline,
  detail,
  actionLabel,
  onAction,
  onDismiss,
}: {
  headline: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "11px 22px",
        background: theme.accentWash,
        borderBottom: `1px solid ${theme.accentRule}`,
        borderLeft: `3px solid ${palette.red}`,
      }}
    >
      <Eyebrow color={palette.red} style={{ flex: "0 0 auto" }}>
        Attention
      </Eyebrow>
      <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: theme.textStrong }}>{headline}</span>
        <span style={{ color: theme.textMuted, marginLeft: 8 }}>{detail}</span>
      </div>
      {actionLabel && onAction && (
        <Button variant="accent" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ flex: "0 0 auto", cursor: "pointer", border: "none", background: "transparent", color: theme.textFaint, padding: 4 }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>("home");
  const [settings, setLocalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<Status>(UNKNOWN_STATUS);
  const [models, setModels] = useState<ModelsReport | null>(null);
  // Set once macOS has answered, so the setup screen never flashes on launch.
  const [statusKnown, setStatusKnown] = useState(false);
  // "Skip for now" on the setup screen, for this session only.
  const [skipped, setSkipped] = useState(false);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  // Stable across renders. It used to be rebuilt on every render, which tore
  // down and restarted any interval keyed on it — a poll that resets its own
  // clock on every tick is a poll that can be starved.
  const refresh = useCallback(
    () =>
      Promise.all([getStatus(), getModels()]).then(([s, m]) => {
        setStatus(s);
        setModels(m);
        setStatusKnown(true);
      }),
    [],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    getSettings().then(setLocalSettings);
    refresh();
    getLastError().then(setLastError);
  }, []);

  // The permission heartbeat lives in Rust now (`permissions::watch`) and is
  // pushed here the instant macOS changes its mind. That matters because the
  // reader grants the microphone from *System Settings*, with this window
  // behind it or closed to the tray — and a webview that isn't rendering runs
  // no timers at all. (Measured on 0.1.1: hide the Hub and its status calls
  // stop 4.4s later and never resume, while a Rust thread keeps ticking every
  // half second.) Waiting on our own setInterval was half of why "it didn't
  // recognize that I had given it microphone permissions" happened.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void onPermissions((p) => {
      setStatus((prev) => ({ ...prev, ...p }));
      setStatusKnown(true);
    }).then((u) => (gone ? u() : (stop = u)));
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  // Coming back to the window is the other moment the reader expects the truth:
  // they just flipped a switch in System Settings and tabbed back here.
  useEffect(() => {
    const sync = () => void refreshRef.current();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Backstop poll for the whole session — a permission can lapse while Koe is
  // running, and every update is a new app to macOS whose earlier grants no
  // longer apply (see the "stale TCC entry" case in hotkey.rs).
  useEffect(() => {
    const id = setInterval(() => void refreshRef.current(), 5000);
    return () => clearInterval(id);
  }, []);

  // Live-update the moment the dictation pipeline reports a failure
  // (`diag::report` in src-tauri), instead of waiting for the next poll.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<LastError>("koe://error", (e) => {
          setLastError(e.payload);
          setErrorDismissed(false);
        }),
      )
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  const update = (s: Settings) => {
    setLocalSettings(s);
    void setSettings(s);
  };

  // Until macOS has answered, show just the page colour: no flash of either the
  // setup screen or the app.
  if (!statusKnown || !models) {
    return <div style={{ height: "100vh", background: theme.pageBg }} />;
  }

  // The setup screen stays until Koe can actually dictate: both permissions on
  // (it comes back after every update, since each new build is a new app to
  // macOS) and a speech model loaded. "Skip for now" dismisses it for the session.
  const speechLoaded = models.models.some((m) => m.kind === "whisper" && m.active);
  const ready = status.accessibility && status.microphone && speechLoaded;
  if (!ready && !skipped) {
    return <Onboarding status={status} models={models} refresh={refresh} onSkip={() => setSkipped(true)} />;
  }

  // Two independent reasons for the banner: a permission is missing after
  // "Skip for now", or the pipeline reported some other failure (hotkey tap
  // dead, paste failed, empty transcript, …).
  const banner = errorDismissed
    ? null
    : !status.accessibility
      ? {
          headline: "Accessibility permission needed",
          detail: "Koe can't type into other apps until it's on.",
          actionLabel: "Grant Accessibility",
          onAction: () => requestAccessibility(),
        }
      : !status.microphone
        ? {
            headline: "Microphone permission needed",
            detail: "Koe can't hear you until it's on.",
            actionLabel: "Grant Microphone",
            onAction: () => requestMicrophone(),
          }
        : !speechLoaded
          ? {
              headline: "No speech model loaded",
              detail: "Download one on the Models page to start dictating.",
              actionLabel: "Open Models",
              onAction: () => setPage("models"),
            }
          : lastError
            ? { headline: lastError.headline, detail: lastError.detail }
            : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        color: theme.textBody,
        background: theme.pageBg,
      }}
    >
      {banner && (
        <ErrorBanner
          headline={banner.headline}
          detail={banner.detail}
          actionLabel={banner.actionLabel}
          onAction={banner.onAction}
          onDismiss={() => setErrorDismissed(true)}
        />
      )}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Sidebar page={page} setPage={setPage} />
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          <div key={page} className="koe-rise" style={{ padding: "40px 48px 56px", maxWidth: 1040 }}>
            {page === "home" && <Home hotkey={prettyAccelerator(settings.hands_free_hotkey) } />}
            {page === "dictionary" && <DictionaryPane />}
            {page === "models" && <ModelsPane settings={settings} onChange={update} />}
            {page === "settings" && (
              <SettingsPane
                settings={settings}
                onChange={update}
                status={status}
                refresh={refresh}
                onOpenPrivacy={() => setPage("privacy")}
              />
            )}
            {page === "help" && <Help />}
            {page === "privacy" && <PrivacyPane />}
          </div>
        </main>
      </div>
    </div>
  );
}
