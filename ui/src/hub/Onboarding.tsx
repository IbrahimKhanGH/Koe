import { useEffect, useRef } from "react";
import { font, motion, palette } from "../tokens/values";
import { theme } from "./theme";
import { Assembly, Wordmark } from "./motifs";
import { Button, Eyebrow, StatusMark } from "./ui";
import { requestAccessibility, requestMicrophone, requestInputMonitoring, type Status } from "./api";

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
  refresh,
  onEnter,
}: {
  status: Status;
  refresh: () => void;
  onEnter: () => void;
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
  const canEnter = acc && mic;

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
            Three switches,
            <br />
            then just talk.
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 13.5, lineHeight: 1.6, margin: "0 0 26px" }}>
            Grant these in order. Each one marks itself done the moment macOS applies it — no relaunch.
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
          <div style={{ borderBottom: `1px solid ${theme.rule}` }}>
            <Step
              n={3}
              title="Input Monitoring"
              detail="Extra reliability for key detection. You can skip it."
              done={inp}
              active={acc && mic && !inp}
              locked={!(acc && mic)}
              required={false}
              onGrant={() => requestInputMonitoring()}
            />
          </div>

          <div style={{ marginTop: 26 }}>
            <Button variant="ink" onClick={onEnter} disabled={!canEnter}>
              {canEnter ? "Start using Koe  →" : "Grant Accessibility and Microphone to continue"}
            </Button>
          </div>

          <p style={{ fontSize: 12, color: theme.textFaint, lineHeight: 1.55, marginTop: 18 }}>
            If a step stays unchecked after you switch it on in System Settings, switch Koe off and on again there.
          </p>
        </div>
      </div>
    </div>
  );
}
