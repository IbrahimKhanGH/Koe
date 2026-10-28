import { useCallback, useEffect, useRef, useState } from "react";
import { palette } from "../tokens/values";
import { theme } from "./theme";
import { Onboarding } from "./Onboarding";
import { Sidebar, type Page } from "./Sidebar";
import { Home } from "./Home";
import { DictionaryPane } from "./DictionaryPane";
import { SettingsPane } from "./SettingsPane";
import { Help } from "./Help";
import { Icon } from "./icons";
import { Button, Eyebrow } from "./ui";
import { prettyAccelerator } from "./format";
import {
  getSettings,
  setSettings,
  getStatus,
  getLastError,
  onPermissions,
  requestAccessibility,
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
  const [entered, setEntered] = useState(() => {
    try { return localStorage.getItem("koe_onboarding_done") === "1"; } catch { return false; }
  });
  const [status, setStatus] = useState<Status>(UNKNOWN_STATUS);
  const [lastError, setLastError] = useState<LastError | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const markEntered = () => {
    try { localStorage.setItem("koe_onboarding_done", "1"); } catch { /* ignore */ }
    setEntered(true);
  };

  // Stable across renders. It used to be rebuilt on every render, which tore
  // down and restarted any interval keyed on it — a poll that resets its own
  // clock on every tick is a poll that can be starved.
  const refresh = useCallback(
    () =>
      getStatus().then((s) => {
        setStatus(s);
        // Auto-enter if both required permissions are already granted so the user
        // never sees the Onboarding gate on a re-open after a successful setup.
        if (s.accessibility && s.microphone) markEntered();
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
      setStatus((prev) => {
        const next = { ...prev, ...p };
        if (next.accessibility && next.microphone) markEntered();
        return next;
      });
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

  // Backstop poll for the whole session, not just during onboarding — a
  // permission can lapse after `entered` is already true (a rebuild with a new
  // ad-hoc signature invalidates a prior macOS Accessibility grant; see the
  // "stale TCC entry" case in hotkey.rs), and that used to go completely
  // unnoticed until the user dug through logs.
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

  // Gate the app behind the setup wizard until the required permissions are granted.
  if (!(status.accessibility && status.microphone) && !entered) {
    return <Onboarding status={status} refresh={refresh} onEnter={markEntered} />;
  }

  // Two independent reasons for the post-onboarding banner: Accessibility
  // lapsed after entry (checked live against `status`, not just the one-time
  // onboarding gate), or the pipeline reported some other failure (hotkey tap
  // dead, paste failed, empty transcript, …).
  const accessibilityLapsed = entered && !status.accessibility;
  const banner = errorDismissed
    ? null
    : accessibilityLapsed
      ? {
          headline: "Accessibility permission needed",
          detail: "Koe can no longer type into other apps — grant it again to keep dictating.",
          actionLabel: "Grant Accessibility",
          onAction: () => requestAccessibility(),
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
            {page === "settings" && (
              <SettingsPane settings={settings} onChange={update} status={status} refresh={refresh} />
            )}
            {page === "help" && <Help />}
          </div>
        </main>
      </div>
    </div>
  );
}
