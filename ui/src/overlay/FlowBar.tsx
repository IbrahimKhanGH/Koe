import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { font, geometry, motion, palette, pillFill } from "../tokens/values";

// Visual states, mirroring the Rust `BarState`.
export type BarState =
  | "idle"
  | "recording"
  | "locked"
  | "transcribing"
  | "done"
  | "cancelled"
  | "error";

type StateEvent = { state: BarState };
type WaveformEvent = { bars: number[] };
// Mirrors `diag::ErrorDto` in src-tauri/src/diag.rs.
type ErrorEvent = { headline: string; detail: string };

async function tauriListen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(event, (e) => cb(e.payload as T));
  } catch {
    return () => {};
  }
}

// Fire a backend command. Used by the pill's Stop/Cancel buttons to reach the
// dictation state machine.
async function tauriInvoke(command: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(command);
  } catch {
    // No-op outside a Tauri webview (e.g. a plain browser preview).
  }
}

// Make the overlay window ignore (or catch again) mouse events.
async function setClickThrough(ignore: boolean): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setIgnoreCursorEvents(ignore);
  } catch {
    // No-op outside a Tauri webview.
  }
}

// The voice as warp threads: thin vertical lines whose length follows the mic
// level, crossed by one red weft line. A slow ripple keeps it alive in silence.
function ThreadWaveform({ bars }: { bars: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<number[]>(bars);
  barsRef.current = bars;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const N = 27;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = performance.now();
      const step = w / N;
      const levels = barsRef.current;
      ctx.fillStyle = pillFill.text;
      for (let i = 0; i < N; i++) {
        const real = levels.length ? levels[levels.length - 1 - (i % levels.length)] : 0;
        const ripple = 0.08 + 0.05 * Math.sin(t / 320 + i * 0.55);
        const amp = Math.min(1, Math.max(ripple, real ?? 0));
        const bh = 2 + amp * (h - 4);
        const x = Math.round(i * step + step / 2);
        ctx.fillRect(x, (h - bh) / 2, 1.5, bh);
      }
      // The weft.
      ctx.fillStyle = palette.red;
      ctx.fillRect(0, Math.round(h / 2) - 0.5, w, 1);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: 26, display: "block" }} />;
}

// A shuttle running along a thread while the transcript is cleaned up.
function Shuttle() {
  return (
    <div style={{ position: "relative", width: 46, height: 6, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 2.5, height: 1, background: "rgba(244,240,230,0.28)" }} />
      <div
        style={{
          position: "absolute",
          top: 1,
          width: 12,
          height: 4,
          background: palette.red,
          animation: "koe-shuttle 900ms cubic-bezier(0.45, 0, 0.55, 1) infinite alternate",
        }}
      />
    </div>
  );
}

function PillButton({
  title,
  onClick,
  children,
  fill,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  fill: string;
}) {
  return (
    <div
      title={title}
      aria-label={title}
      role="button"
      onClick={onClick}
      className="koe-pill-btn"
      style={{
        flex: "0 0 auto",
        width: 24,
        height: 24,
        borderRadius: 2,
        background: fill,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {children}
    </div>
  );
}

function Label({ children, mark }: { children: ReactNode; mark?: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {mark && <span style={{ width: 6, height: 6, background: mark }} />}
      <span style={{ fontFamily: font.mono, fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: pillFill.textMuted }}>
        {children}
      </span>
    </span>
  );
}

export function FlowBar() {
  const [state, setState] = useState<BarState>("idle");
  const [bars, setBars] = useState<number[]>([]);
  // Set by `koe://error`, shown while state === "error". Falls back to a
  // generic line if the error-state event somehow arrives without one (e.g.
  // an older build, or a future ShowBar(Error) call that doesn't go through
  // `diag::report`).
  const [errorText, setErrorText] = useState<ErrorEvent | null>(null);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    tauriListen<StateEvent>("koe://flowbar/state", (p) => setState(p.state)).then((u) => (un1 = u));
    tauriListen<WaveformEvent>("koe://audio/waveform", (p) => setBars(p.bars)).then((u) => (un2 = u));
    tauriListen<ErrorEvent>("koe://error", (p) => setErrorText(p)).then((u) => (un3 = u));
    return () => {
      un1?.();
      un2?.();
      un3?.();
    };
  }, []);

  const recording = state === "recording" || state === "locked";
  const isIdle = state === "idle";
  const processing = state === "transcribing";
  const isError = state === "error";

  // The overlay is an always-on-top window parked over the bottom of the screen.
  // Outside of recording (Stop/Cancel buttons) and errors (hover for the detail
  // tooltip) it has nothing to click, so let clicks fall through to whatever app
  // is underneath instead of the idle pill blocking its bottom bar.
  const interactive = recording || isError;
  useEffect(() => {
    void setClickThrough(!interactive);
  }, [interactive]);
  // Plate dimensions per state. Error gets extra width so the specific
  // headline (e.g. "Accessibility permission needed") isn't clipped.
  const dims = isIdle
    ? { w: 44, h: 8 }
    : recording
      ? { w: 252, h: 44 }
      : isError
        ? { w: 280, h: 34 }
        : { w: 168, h: 34 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: font.ui,
        userSelect: "none",
      }}
    >
      <div
        aria-label={`Koe ${state}${isError && errorText ? `: ${errorText.detail}` : ""}`}
        title={isError ? errorText?.detail : undefined}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: recording ? "space-between" : "center",
          gap: 12,
          height: dims.h,
          width: dims.w,
          padding: recording ? "0 10px" : "0 14px",
          background: pillFill.base,
          border: isIdle ? "none" : `1px solid ${pillFill.border}`,
          borderRadius: isIdle ? 2 : 6,
          boxShadow: isIdle ? "none" : pillFill.shadow,
          opacity: isIdle ? 0.55 : 1,
          color: pillFill.text,
          transition: `width ${geometry.morphMs}ms ${motion.ease}, height ${geometry.morphMs}ms ${motion.ease}, border-radius ${geometry.morphMs}ms ${motion.ease}, opacity ${geometry.morphMs}ms`,
          overflow: "hidden",
          fontSize: 12.5,
        }}
      >
        {isError && <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: palette.red }} />}
        {isIdle ? (
          <span style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, background: palette.red }} />
        ) : recording ? (
          <>
            <PillButton title="Discard (Esc)" fill="rgba(244,240,230,0.12)" onClick={() => void tauriInvoke("cancel_dictation")}>
              <span style={{ color: pillFill.text, fontSize: 12, lineHeight: 1 }}>✕</span>
            </PillButton>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ThreadWaveform bars={bars} />
            </div>
            <PillButton title="Stop and paste" fill={palette.red} onClick={() => void tauriInvoke("stop_dictation")}>
              <span style={{ width: 8, height: 8, background: "#fff" }} />
            </PillButton>
          </>
        ) : processing ? (
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Shuttle />
            <Label>Writing</Label>
          </span>
        ) : isError ? (
          <span style={{ color: pillFill.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {errorText?.headline ?? "Something's off"}
          </span>
        ) : state === "cancelled" ? (
          <Label mark={pillFill.textMuted}>Discarded</Label>
        ) : (
          <Label mark={palette.chartreuse}>Written</Label>
        )}
      </div>
    </div>
  );
}
