import { useEffect, useRef, useState } from "react";
import { font, motion, palette } from "../tokens/values";
import { theme } from "./theme";
import { Assembly, Wordmark } from "./motifs";
import { Button, Eyebrow, StatusMark } from "./ui";
import {
  downloadModels,
  requestAccessibility,
  requestInputMonitoring,
  requestMicrophone,
  restartApp,
  type ModelsReport,
  type Status,
  type Tier,
} from "./api";
import { TIERS } from "./ModelsPane";

function gb(bytes: number): string {
  const v = bytes / 1e9;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)} GB`;
}

// Step 04: pick a tier and download it, without leaving setup. The download runs
// in Terminal (Koe has no network code); this step watches the files arrive and
// shows progress, then asks for a restart so Koe loads them.
function ModelStep({ n, report, active }: { n: number; report: ModelsReport; active: boolean }) {
  const [tier, setTier] = useState<Tier>("balanced");
  const [started, setStarted] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const tierFiles = (t: Tier) => report.models.filter((m) => m.tiers.includes(t));
  const files = tierFiles(tier);
  const total = files.reduce((s, m) => s + m.size, 0);
  const got = files.reduce((s, m) => s + Math.min(m.downloaded, m.size), 0);
  const failed = files.filter((m) => m.failed_check);
  const allInstalled = files.length > 0 && files.every((m) => m.installed);
  const speechLoaded = report.models.some((m) => m.kind === "whisper" && m.active);
  // In progress = this click started one, or get-models.sh has a partial file on disk.
  const inProgress = files.some((m) => !m.installed && m.downloaded > 0);
  const downloading = !allInstalled && (started || inProgress);
  // Max keeps ~20 GB in memory while Koe runs; don't offer it where that won't fit.
  const maxFits = report.memory_gb === 0 || report.memory_gb >= 32;

  const start = async () => {
    setStarted(true);
    setNote(await downloadModels(tier));
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr)",
        gap: 14,
        padding: "18px 0",
        borderTop: `1px solid ${active ? theme.textStrong : theme.rule}`,
      }}
    >
      <span style={{ fontFamily: font.mono, fontSize: 11, color: active ? palette.red : theme.textFaint, paddingTop: 3 }}>
        {String(n).padStart(2, "0")}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong }}>Download the models</span>
            <Eyebrow>Required</Eyebrow>
          </span>
          {speechLoaded && (
            <span style={{ display: "flex", alignItems: "center" }}>
              <StatusMark ok />
              <Eyebrow color={theme.textMuted}>Loaded</Eyebrow>
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.textMuted, marginTop: 4 }}>
          Official, openly licensed models that run on this Mac. One download; nothing you say is ever sent anywhere.
        </div>

        {!speechLoaded && !allInstalled && !downloading && (
          <>
            <div role="radiogroup" aria-label="Model tier" style={{ display: "grid", gap: 6, marginTop: 14 }}>
              {TIERS.map((t) => {
                const disabled = t.key === "max" && !maxFits;
                const selected = tier === t.key;
                const size = tierFiles(t.key).reduce((s, m) => s + m.size, 0);
                return (
                  <button
                    key={t.key}
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    onClick={() => setTier(t.key)}
                    className={selected || disabled ? undefined : "koe-seg"}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "12px 84px minmax(0, 1fr) auto",
                      alignItems: "baseline",
                      gap: 10,
                      textAlign: "left",
                      padding: "10px 12px",
                      cursor: disabled ? "default" : "pointer",
                      border: `1px solid ${selected ? palette.red : theme.ruleStrong}`,
                      background: selected ? "rgba(214, 36, 41, 0.05)" : "transparent",
                      opacity: disabled ? 0.45 : 1,
                    }}
                  >
                    <span style={{ width: 8, height: 8, background: selected ? palette.red : "transparent", border: `1px solid ${selected ? palette.red : theme.ruleStrong}` }} />
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: theme.textStrong }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: 12, color: theme.textMuted }}>
                      {disabled
                        ? `Needs 32 GB of memory; this Mac has ${report.memory_gb} GB.`
                        : t.key === "balanced"
                          ? "Recommended. Best accuracy for the size."
                          : t.blurb}
                    </span>
                    <span style={{ fontFamily: font.mono, fontSize: 11, color: theme.textFaint }}>{gb(size)}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <Button variant={active ? "accent" : "ink"} size="sm" onClick={() => void start()}>
                Download {TIERS.find((t) => t.key === tier)?.name} · {gb(total - got)}
              </Button>
            </div>
          </>
        )}

        {downloading && (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 4, background: theme.surfaceSunk }}>
              <div style={{ height: 4, width: `${total ? (got / total) * 100 : 0}%`, background: palette.red, transition: "width 600ms" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: theme.textMuted }}>
              <span>
                {got >= total && total > 0
                  ? "Checking fingerprints…"
                  : `Downloading in Terminal. Keep that window open.`}
              </span>
              <span style={{ fontFamily: font.mono, fontSize: 11 }}>
                {gb(got)} of {gb(total)}
              </span>
            </div>
            {note && <div style={{ fontSize: 12, color: palette.red, marginTop: 6 }}>{note}</div>}
            {got === 0 && (
              <button
                onClick={() => void start()}
                style={{ marginTop: 8, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: theme.textMuted, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                No Terminal window? Open it again
              </button>
            )}
          </div>
        )}

        {failed.length > 0 && (
          <div style={{ fontSize: 12, color: palette.red, marginTop: 10 }}>
            {failed.map((m) => m.label).join(", ")} didn't match its fingerprint and won't be used. Download again.
          </div>
        )}

        {allInstalled && !speechLoaded && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <Button variant="accent" size="sm" onClick={() => void restartApp()}>
              Restart Koe to finish
            </Button>
            <span style={{ fontSize: 12, color: theme.textMuted }}>Downloaded and verified. Koe loads them on restart.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// A blocking permission gate: the app can't be used until Accessibility and
// Microphone are granted. The three permissions are presented in order (each
// unlocks the next), and their state flips live as macOS applies them.

function Step({
  n,
  title,
  detail,
  done,
  active,
  locked,
  required,
  onGrant,
}: {
  n: number;
  title: string;
  detail: string;
  done: boolean;
  active: boolean;
  locked: boolean;
  required: boolean;
  onGrant: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "34px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 14,
        padding: "18px 0",
        borderTop: `1px solid ${active ? theme.textStrong : theme.rule}`,
        opacity: locked ? 0.45 : 1,
        transition: `opacity ${motion.base}ms`,
      }}
    >
      <span style={{ fontFamily: font.mono, fontSize: 11, color: active ? palette.red : theme.textFaint }}>
        {String(n).padStart(2, "0")}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong }}>{title}</span>
          <Eyebrow>{required ? "Required" : "Optional"}</Eyebrow>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.textMuted, marginTop: 4 }}>{detail}</div>
      </div>
      {done ? (
        <span style={{ display: "flex", alignItems: "center" }}>
          <StatusMark ok />
          <Eyebrow color={theme.textMuted}>Granted</Eyebrow>
        </span>
      ) : (
        <Button variant={active ? "accent" : "ink"} size="sm" onClick={onGrant} disabled={locked}>
          Grant
        </Button>
      )}
    </div>
  );
}

export function Onboarding({
  status,
  models,
  refresh,
  onSkip,
}: {
  status: Status;
  models: ModelsReport;
  refresh: () => void;
  onSkip: () => void;
}) {
  // A backstop poll. The state actually flips on the heartbeat Rust pushes at
  // us (`permissions::watch` → `koe://permissions`), because this webview
  // stops running timers within seconds of its window going away — and the
  // reader grants the microphone from System Settings, i.e. with this window
  // behind it or closed to the tray.
  //
  // Held in a ref so the interval survives re-renders instead of restarting its
  // clock on each one.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const id = setInterval(() => refreshRef.current(), 1200);
    return () => clearInterval(id);
  }, []);

  const acc = status.accessibility;
  const mic = status.microphone;
  const inp = status.input_monitoring;

  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateColumns: "minmax(280px, 0.85fr) minmax(0, 1.15fr)", background: theme.pageBg }}>
      {/* The plate: ink, with the seal glyph and the assembly. */}
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          background: palette.ink,
          color: palette.ivory,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "34px 36px",
        }}
      >
        <Eyebrow color="#8F8A7E">On-device dictation</Eyebrow>
        <div>
          <div
            className="koe-rise"
            style={{ fontFamily: font.mincho, fontWeight: 600, fontSize: 168, lineHeight: 1, letterSpacing: 0 }}
          >
            声
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 18 }}>
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-0.03em" }}>Koe</span>
            <span style={{ fontFamily: font.mono, fontSize: 11, letterSpacing: "0.12em", color: "#8F8A7E" }}>
              /ko·e/ — VOICE
            </span>
          </div>
          <div style={{ width: 28, height: 3, background: palette.red, marginTop: 18 }} />
        </div>
        <div style={{ opacity: 0.9 }}>
          <Assembly width={200} inverse />
        </div>
      </div>

      {/* The steps. */}
      <div style={{ display: "flex", alignItems: "center", padding: "40px 52px", overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 500 }}>
          <Wordmark size={15} />
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 34,
              fontWeight: 500,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              margin: "28px 0 10px",
              color: theme.textStrong,
            }}
          >
            Four steps,
            <br />
            then just talk.
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 26px" }}>
            Grant these in order. Each one marks itself done the moment macOS applies it — no relaunch. Just
            updated? macOS treats every new version of Koe as a new app, so it asks again; Grant clears the old
            entry first.
          </p>

          <Step
            n={1}
            title="Accessibility"
            detail="Sees the fn key in every app and types your words where the cursor is."
            done={acc}
            active={!acc}
            locked={false}
            required
            onGrant={() => requestAccessibility()}
          />
          <Step
            n={2}
            title="Microphone"
            // macOS can be answering about a different app entirely (whatever
            // launched us), in which case granting Koe here can never mark this
            // done — so say whose switch actually counts.
            detail={status.microphone_hint ?? "Hears what you say. Audio never leaves this Mac."}
            done={mic}
            active={acc && !mic}
            locked={!acc}
            required
            onGrant={() => requestMicrophone()}
          />
          <Step
            n={3}
            title="Input Monitoring"
            detail="Extra reliability for key detection. You can skip it."
            done={inp}
            active={false}
            locked={!(acc && mic)}
            required={false}
            onGrant={() => requestInputMonitoring()}
          />
          <div style={{ borderBottom: `1px solid ${theme.rule}` }}>
            <ModelStep n={4} report={models} active={acc && mic} />
          </div>

          <p style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.55, marginTop: 22 }}>
            Koe opens by itself once Accessibility and Microphone are on and a speech model is loaded. If a step stays
            unchecked after you switch it on in System Settings, click its Grant button again.
          </p>
          <button
            onClick={onSkip}
            style={{
              marginTop: 10,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 12,
              color: theme.textMuted,
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
