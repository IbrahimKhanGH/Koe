import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Wordmark } from "./motifs";
import { Eyebrow } from "./ui";

export type Page = "home" | "dictionary" | "models" | "settings" | "help";

export const PAGES: { key: Page; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "dictionary", label: "Dictionary" },
  { key: "models", label: "Models" },
  { key: "settings", label: "Settings" },
  { key: "help", label: "Help" },
];

export function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  return (
    <aside
      style={{
        width: 208,
        flex: "0 0 208px",
        borderRight: `1px solid ${theme.rule}`,
        background: theme.sidebarBg,
        display: "flex",
        flexDirection: "column",
        padding: "22px 0 18px",
      }}
    >
      <div style={{ padding: "4px 22px 32px" }}>
        <Wordmark size={21} />
      </div>

      <nav aria-label="Sections" style={{ display: "flex", flexDirection: "column" }}>
        {PAGES.map((p, i) => {
          const active = page === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPage(p.key)}
              aria-current={active ? "page" : undefined}
              className="koe-nav"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 14,
                width: "100%",
                textAlign: "left",
                border: "none",
                borderLeft: `2px solid ${active ? palette.red : "transparent"}`,
                background: active ? theme.hover : "transparent",
                cursor: "pointer",
                padding: "10px 20px",
                color: active ? theme.textStrong : theme.textMuted,
                transition: "color 140ms, background 140ms",
              }}
            >
              <span
                style={{
                  fontFamily: font.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  color: active ? palette.red : theme.textFaint,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, letterSpacing: "-0.005em" }}>
                {p.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{ margin: "0 18px", padding: "14px 0 0", borderTop: `1px solid ${theme.rule}` }}>
        <Eyebrow style={{ marginBottom: 8 }}>On-device</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.textMuted }}>
          <span style={{ width: 7, height: 7, background: palette.chartreuse, outline: "1px solid rgba(18,18,17,0.25)" }} />
          Nothing leaves this Mac
        </div>
      </div>
    </aside>
  );
}
