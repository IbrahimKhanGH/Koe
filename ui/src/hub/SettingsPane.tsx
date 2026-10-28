import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Eyebrow, Key, PageTitle, Segmented, StatusMark } from "./ui";
import { prettyAccelerator } from "./format";
import {
  requestAccessibility,
  requestInputMonitoring,
  requestMicrophone,
  setHandsFreeHotkey,
  type CleanupLevel,
  type CleanupMode,
  type Settings,
  type Status,
} from "./api";

const MODES: { value: CleanupMode; label: string; hint: string }[] = [
  { value: "local", label: "Local model", hint: "Removes fillers, fixes punctuation and self-corrections, formats lists." },
  { value: "raw", label: "Raw", hint: "Pastes exactly what speech recognition heard." },
];

const LEVELS: { value: CleanupLevel; label: string; hint: string }[] = [
  { value: "none", label: "None", hint: "Exactly what you said, mistakes included." },
  { value: "light", label: "Light", hint: "Filler words and grammar. Recommended." },
  { value: "medium", label: "Medium", hint: "Edited for clarity and concision." },
  { value: "high", label: "High", hint: "Rewritten for brevity and polish." },
];

// One numbered row of the settings sheet: what it is on the left, the control
// on the right, a hairline between rows.
function Row({ index, title, desc, children }: { index: number; title: string; desc: ReactNode; children: ReactNode }) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(200px, 1fr) minmax(0, 1.55fr)",
        gap: 32,
        padding: "26px 0",
        borderTop: `1px solid ${theme.rule}`,
      }}
    >
      <div>
        <Eyebrow index={index}>{title}</Eyebrow>
        <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.55, marginTop: 10 }}>{desc}</div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  );
}

// A physical key from a KeyboardEvent.code, as a Tauri accelerator key name.
// Returns null for a bare modifier press (so the recorder keeps listening) and
// for keys we don't want to bind.
function keyNameFromCode(code: string): string | null {
  if (code === "Space") return "Space";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  return null;
}

// A KeyboardEvent → a Tauri accelerator string ("CmdOrCtrl+Shift+Space"), or
// null if it isn't a valid global shortcut yet (no non-modifier key, or no
// modifier — a bare key makes a terrible global hotkey).
function acceleratorFromEvent(e: KeyboardEvent): string | null {
  const key = keyNameFromCode(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.metaKey) parts.push("CmdOrCtrl");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

// The toggle shortcut: press once to start dictating, again to stop and paste.
// Click to record a new shortcut; the next modifier+key you press becomes it.
// Esc while recording cancels. A combo that can't be registered (taken by macOS
// or another app) is shown as an error and the previous one stays active.
function ToggleShortcut({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (accelerator: string) => {
      const problem = await setHandsFreeHotkey(accelerator);
      setError(problem);
      if (!problem) onChange(accelerator);
    },
    [onChange],
  );

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (accelerator) {
        void apply(accelerator);
        setRecording(false);
      }
      // Otherwise a bare modifier is still held — keep listening for the key.
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, apply]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={() => setRecording((on) => !on)}
          aria-label="Record a new toggle shortcut"
          style={{
            minWidth: 190,
            padding: "14px 18px",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: font.mono,
            fontSize: 17,
            letterSpacing: "0.04em",
            color: recording ? palette.red : theme.textStrong,
            background: palette.ivory,
            border: `1px solid ${recording ? palette.red : theme.ruleStrong}`,
            borderBottomWidth: 3,
            borderRadius: 3,
            transition: "border-color 140ms, color 140ms",
          }}
        >
          {recording ? "Press keys…" : prettyAccelerator(value)}
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={() => setRecording((on) => !on)}>
            {recording ? "Cancel" : "Change"}
          </Button>
          {value.trim() !== "" && !recording && (
            <Button variant="ghost" size="sm" onClick={() => void apply("")}>
              Turn off
            </Button>
          )}
        </div>
      </div>
      {recording && (
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 12 }}>
          Hold a modifier (<Key>⌘</Key> <Key>⌥</Key> <Key>⌃</Key> <Key>⇧</Key>) and press a key. <Key>esc</Key> cancels.
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{ fontSize: 12.5, color: palette.red, marginTop: 12, paddingLeft: 10, borderLeft: `2px solid ${palette.red}` }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function LevelList({ value, onChange }: { value: CleanupLevel; onChange: (v: CleanupLevel) => void }) {
  return (
    <div role="radiogroup" style={{ border: `1px solid ${theme.ruleStrong}`, borderRadius: 3, overflow: "hidden" }}>
      {LEVELS.map((l, i) => {
        const selected = value === l.value;
        return (
          <button
            key={l.value}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(l.value)}
            className={selected ? undefined : "koe-seg"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              textAlign: "left",
              cursor: "pointer",
              padding: "12px 14px",
              border: "none",
              borderTop: i === 0 ? "none" : `1px solid ${theme.rule}`,
              background: selected ? palette.ink : "transparent",
              transition: "background 140ms",
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                flex: "0 0 auto",
                background: selected ? palette.red : "transparent",
                border: `1px solid ${selected ? palette.red : theme.ruleStrong}`,
              }}
            />
            <span style={{ flex: "0 0 74px", fontSize: 13.5, fontWeight: 600, color: selected ? palette.ivory : theme.textStrong }}>
              {l.label}
            </span>
            <span style={{ fontSize: 12.5, color: selected ? "#C9C3B6" : theme.textMuted }}>{l.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function Permission({
  ok,
  optional = false,
  label,
  detail,
  onGrant,
}: {
  ok: boolean;
  optional?: boolean;
  label: string;
  detail: string;
  onGrant: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: `1px solid ${theme.rule}` }}>
      <StatusMark ok={ok} optional={optional} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>{label}</div>
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 2 }}>{detail}</div>
      </div>
      {ok ? (
        <Eyebrow color={theme.textMuted}>Granted</Eyebrow>
      ) : (
        <Button variant="ink" size="sm" onClick={onGrant}>
          Grant
        </Button>
      )}
    </div>
  );
}

export function SettingsPane({
  settings,
  onChange,
  status,
  refresh,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  status: Status;
  refresh: () => void;
}) {
  const mode = MODES.find((m) => m.value === settings.cleanup_mode);
  return (
    <div style={{ maxWidth: 860 }}>
      <PageTitle index={3} eyebrow="Settings" sub="Everything runs on this Mac. Nothing you say is ever sent anywhere.">
        Your setup
      </PageTitle>

      <Row
        index={1}
        title="Toggle shortcut"
        desc={
          <>
            Press once to start talking with no key held, again to stop and paste. Holding <Key>fn</Key> and
            double-tapping <Key>fn</Key> always work too.
          </>
        }
      >
        <ToggleShortcut
          value={settings.hands_free_hotkey ?? ""}
          onChange={(accelerator) => onChange({ ...settings, hands_free_hotkey: accelerator })}
        />
      </Row>

      <Row index={2} title="Cleanup engine" desc="How your words are tidied before they're typed.">
        <Segmented
          options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          value={settings.cleanup_mode}
          onChange={(v) => onChange({ ...settings, cleanup_mode: v })}
        />
        <div style={{ fontSize: 12.5, color: theme.textMuted, marginTop: 10 }}>{mode?.hint}</div>
      </Row>

      <Row index={3} title="Cleanup level" desc="How much the local model is allowed to change.">
        <LevelList value={settings.cleanup_level} onChange={(v) => onChange({ ...settings, cleanup_level: v })} />
      </Row>

      <Row index={4} title="Sound" desc="A short tone when recording starts.">
        <Segmented
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          value={settings.sound_on_start ? "on" : "off"}
          onChange={(v) => onChange({ ...settings, sound_on_start: v === "on" })}
        />
      </Row>

      <Row index={5} title="Permissions" desc="macOS asks for these once. The marks update by themselves within a few seconds.">
        <div style={{ borderBottom: `1px solid ${theme.rule}` }}>
          <Permission
            ok={status.accessibility}
            label="Accessibility"
            detail="Sees the fn key in every app and types your words."
            onGrant={() => {
              requestAccessibility();
              setTimeout(refresh, 800);
            }}
          />
          <Permission
            ok={status.microphone}
            label="Microphone"
            // When macOS is judging this as some other app (the terminal that
            // launched us, say), say so instead of pointing at a switch that
            // cannot move this mark.
            detail={status.microphone ? "Hears what you say." : (status.microphone_hint ?? "Hears what you say.")}
            onGrant={() => {
              requestMicrophone();
              setTimeout(refresh, 1000);
            }}
          />
          <Permission
            ok={status.input_monitoring}
            optional
            label="Input Monitoring"
            detail="Optional. Extra reliability for key detection."
            onGrant={() => {
              requestInputMonitoring();
              setTimeout(refresh, 1000);
            }}
          />
        </div>
      </Row>
    </div>
  );
}
