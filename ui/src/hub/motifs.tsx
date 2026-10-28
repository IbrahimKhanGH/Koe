// Koe's visual motifs: the 声 seal, the wordmark, an assembly of interlocking
// rectangles that seat themselves like machined parts, and a thread that draws
// itself across the page like a weft through a loom.

import type { CSSProperties } from "react";
import { font, motion, palette } from "../tokens/values";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

// ── Seal ─────────────────────────────────────────────────────────────────────
// An ink block bearing 声, seated on an offset red square — a maker's stamp.
export function Seal({ size = 30 }: { size?: number }) {
  const off = Math.round(size * 0.16);
  return (
    <span
      aria-hidden
      style={{ position: "relative", display: "inline-block", width: size + off, height: size + off, flex: "0 0 auto" }}
    >
      <span style={{ position: "absolute", left: off, top: off, width: size, height: size, background: palette.red }} />
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: size,
          height: size,
          background: palette.ink,
          color: palette.ivory,
          fontFamily: font.mincho,
          fontWeight: 600,
          fontSize: size * 0.68,
          lineHeight: `${size}px`,
          textAlign: "center",
        }}
      >
        声
      </span>
    </span>
  );
}

// ── Wordmark ─────────────────────────────────────────────────────────────────
export function Wordmark({ size = 19 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.45 }}>
      <span
        style={{
          fontFamily: font.display,
          fontWeight: 700,
          fontSize: size,
          letterSpacing: "-0.02em",
          color: palette.ink,
        }}
      >
        Koe
      </span>
      <span style={{ width: 1, height: size * 0.95, background: palette.ruleStrong }} />
      <span style={{ fontFamily: font.mincho, fontWeight: 600, fontSize: size * 0.95, color: palette.ink }}>声</span>
    </span>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────
// A short red lead followed by a long hairline, drawn left to right.
export function Thread({ delay = 0 }: { delay?: number }) {
  const lead = 28;
  const draw = (len: number, d: number): Vars => ({
    strokeDasharray: len,
    "--len": len,
    animation: `koe-draw ${motion.assemble * 1.4}ms ${motion.ease} ${d}ms both`,
  });
  return (
    <svg width="100%" height="3" preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      <line x1="0" y1="1.5" x2={lead} y2="1.5" stroke={palette.red} strokeWidth="3" style={draw(lead, delay)} />
      <line
        x1={lead + 6}
        y1="1.5"
        x2="100%"
        y2="1.5"
        stroke={palette.ruleStrong}
        strokeWidth="1"
        pathLength={1000}
        style={draw(1000, delay + 120)}
      />
    </svg>
  );
}

// ── Assembly ─────────────────────────────────────────────────────────────────
// Interlocking rectangles on an 8px grid. The ink block and the red square
// weave over and under each other where they overlap; each part slides into its
// seat from a short offset, one after another.
type Part = { x: number; y: number; w: number; h: number; fill: string; dx: number; dy: number };

const PARTS: Part[] = [
  { x: 24, y: 56, w: 72, h: 32, fill: palette.powder, dx: -24, dy: 0 },
  { x: 72, y: 24, w: 96, h: 96, fill: palette.ink, dx: 0, dy: -24 },
  { x: 136, y: 72, w: 64, h: 64, fill: palette.red, dx: 24, dy: 0 },
  { x: 136, y: 104, w: 32, h: 16, fill: palette.ink, dx: 0, dy: 16 }, // ink passes back over red
  { x: 184, y: 24, w: 24, h: 24, fill: palette.chartreuse, dx: 0, dy: -16 },
  { x: 48, y: 112, w: 16, h: 16, fill: palette.magenta, dx: -16, dy: 0 },
];

// `inverse` is for ink backgrounds: the ink parts turn ivory so they still read.
export function Assembly({ width = 240, inverse = false }: { width?: number; inverse?: boolean }) {
  const solid = inverse ? palette.ivory : palette.ink;
  const loom = inverse ? "rgba(244,240,230,0.28)" : palette.ruleStrong;
  const thread = (len: number, d: number): Vars => ({
    strokeDasharray: len,
    "--len": len,
    animation: `koe-draw ${motion.assemble * 1.6}ms ${motion.ease} ${d}ms both`,
  });
  return (
    <svg width={width} height={(width * 160) / 240} viewBox="0 0 240 160" aria-hidden style={{ display: "block" }}>
      {/* Warp and weft: the loom the parts sit on. */}
      <line x1="0" y1="40" x2="240" y2="40" stroke={loom} strokeWidth="1" style={thread(240, 80)} />
      <line x1="0" y1="144" x2="240" y2="144" stroke={loom} strokeWidth="1" style={thread(240, 200)} />
      <line x1="216" y1="0" x2="216" y2="160" stroke={palette.red} strokeWidth="1" style={thread(160, 320)} />
      {PARTS.map((p, i) => (
        <rect
          key={i}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          fill={p.fill === palette.ink ? solid : p.fill}
          style={
            {
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              animation: `koe-assemble ${motion.assemble}ms ${motion.ease} ${120 + i * 70}ms both`,
            } as Vars
          }
        />
      ))}
    </svg>
  );
}

// ── Woven grid ───────────────────────────────────────────────────────────────
// A faint warp-and-weft texture for large empty surfaces.
export function WovenGrid({ opacity = 0.5 }: { opacity?: number }) {
  return (
    <svg
      aria-hidden
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}
    >
      <defs>
        <pattern id="koe-weave" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 0.5H24M0.5 0V24" stroke={palette.rule} strokeWidth="1" fill="none" />
          <rect x="0" y="0" width="12" height="2" fill={palette.rule} />
          <rect x="12" y="12" width="2" height="12" fill={palette.rule} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#koe-weave)" />
    </svg>
  );
}
