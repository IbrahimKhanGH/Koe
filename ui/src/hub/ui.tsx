import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { font, geometry, palette } from "../tokens/values";
import { theme } from "./theme";
import { Thread } from "./motifs";
import { getStats, type StatsSummary, EMPTY_STATS } from "./api";

// ── Eyebrow ──────────────────────────────────────────────────────────────────
// The technical label: mono, small caps, wide tracking. `index` prefixes a
// two-digit section number ("02 — Cleanup").
export function Eyebrow({
  children,
  index,
  color = theme.textFaint,
  style,
}: {
  children: ReactNode;
  index?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10.5,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {index !== undefined && (
        <span style={{ color: theme.accent, marginRight: 8 }}>{String(index).padStart(2, "0")}</span>
      )}
      {children}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({
  children,
  style,
  pad = 22,
  label,
  index,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
  label?: ReactNode;
  index?: number;
}) {
  return (
    <section
      style={{
        background: theme.surface,
        border: `1px solid ${theme.rule}`,
        borderRadius: geometry.radius,
        padding: pad,
        ...style,
      }}
    >
      {label && (
        <Eyebrow index={index} style={{ marginBottom: 16 }}>
          {label}
        </Eyebrow>
      )}
      {children}
    </section>
  );
}

// ── Status mark ──────────────────────────────────────────────────────────────
// A small square: chartreuse when something is in order, red when it isn't,
// hollow when it isn't but doesn't need to be (an optional permission).
export function StatusMark({ ok, optional = false, size = 8 }: { ok: boolean; optional?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        background: ok ? palette.chartreuse : optional ? "transparent" : palette.red,
        outline: `1px solid ${ok ? "rgba(18,18,17,0.25)" : optional ? palette.slate : "transparent"}`,
        marginRight: 10,
        flex: "0 0 auto",
      }}
    />
  );
}

// ── Button ───────────────────────────────────────────────────────────────────
// Colors live in the .koe-btn-* classes (main.tsx) so hover states work.
export function Button({
  children,
  onClick,
  variant = "ink",
  size = "md",
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "ink" | "accent" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`koe-btn koe-btn-${variant}`}
      style={{
        cursor: disabled ? "default" : "pointer",
        borderRadius: geometry.radius,
        padding: size === "sm" ? "6px 11px" : "9px 15px",
        fontSize: size === "sm" ? 12 : 13,
        fontWeight: 500,
        letterSpacing: "0.01em",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── Segmented control ────────────────────────────────────────────────────────
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      style={{
        display: "inline-flex",
        border: `1px solid ${theme.ruleStrong}`,
        borderRadius: geometry.radius,
        overflow: "hidden",
      }}
    >
      {options.map((o, i) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={active ? undefined : "koe-seg"}
            style={{
              border: "none",
              borderLeft: i === 0 ? "none" : `1px solid ${theme.ruleStrong}`,
              cursor: "pointer",
              padding: "7px 16px",
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: "0.01em",
              color: active ? palette.ivory : theme.textMuted,
              background: active ? palette.ink : "transparent",
              transition: "background 140ms, color 140ms",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Key cap ──────────────────────────────────────────────────────────────────
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: font.mono,
        fontSize: 11.5,
        color: theme.textStrong,
        background: theme.surface,
        border: `1px solid ${theme.ruleStrong}`,
        borderBottomWidth: 2,
        borderRadius: 2,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </kbd>
  );
}

// ── Text input ───────────────────────────────────────────────────────────────
export const inputStyle: CSSProperties = {
  width: "100%",
  background: palette.ivory,
  border: `1px solid ${theme.ruleStrong}`,
  borderRadius: geometry.radius,
  padding: "9px 11px",
  color: theme.textStrong,
  fontSize: 13.5,
  outline: "none",
};

// ── Page heading ─────────────────────────────────────────────────────────────
export function PageTitle({
  index,
  eyebrow,
  children,
  sub,
  aside,
}: {
  index: number;
  eyebrow: string;
  children: ReactNode;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow index={index}>{eyebrow}</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 38,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              margin: "12px 0 0",
              color: theme.textStrong,
            }}
          >
            {children}
          </h1>
          {sub && (
            <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 1.55, margin: "10px 0 0", maxWidth: 520 }}>
              {sub}
            </p>
          )}
        </div>
        {aside}
      </div>
      <div style={{ marginTop: 22 }}>
        <Thread />
      </div>
    </header>
  );
}

// ── Live stats hook (polls every ~4s so numbers climb while dictating) ───────
export function useStats(): StatsSummary {
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS);
  useEffect(() => {
    let alive = true;
    const load = () => getStats().then((s) => alive && setStats(s));
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return stats;
}
