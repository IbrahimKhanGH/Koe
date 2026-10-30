import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Card, Eyebrow, Key, inputStyle, useStats } from "./ui";
import { Assembly, Thread, WovenGrid } from "./motifs";
import { Icon } from "./icons";
import { copyText, getHistory, type HistoryItem, type StatsSummary } from "./api";
import { appName, dayKey, dayLabel, fmtCompact, fmtDuration, fmtNum, fmtTimeOfDay } from "./format";

// ── Header ───────────────────────────────────────────────────────────────────
function Header({ hotkey }: { hotkey: string }) {
  return (
    <header style={{ marginBottom: 30 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow index={1}>Home</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 46,
              fontWeight: 500,
              letterSpacing: "-0.035em",
              lineHeight: 1,
              margin: "14px 0 0",
              color: theme.textStrong,
            }}
          >
            Speak.
            <br />
            <span style={{ color: theme.textFaint }}>It's written.</span>
          </h1>
          <p style={{ color: theme.textMuted, fontSize: 14, lineHeight: 2, margin: "16px 0 0" }}>
            Hold <Key>fn</Key> and talk, or press <Key>{hotkey}</Key> to start and stop.
            <br />
            Clean text lands wherever your cursor is.
          </p>
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Assembly width={216} />
        </div>
      </div>
      <div style={{ marginTop: 26 }}>
        <Thread delay={200} />
      </div>
    </header>
  );
}

// ── Figures strip ────────────────────────────────────────────────────────────
function Figure({
  label,
  value,
  unit,
  accent,
  first,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  first?: boolean;
}) {
  return (
    <div
      style={{
        padding: first ? "18px 20px 20px 0" : "18px 20px 20px",
        borderLeft: first ? "none" : `1px solid ${theme.rule}`,
        minWidth: 0,
      }}
    >
      <Eyebrow>{label}</Eyebrow>
      <div
        style={{
          fontFamily: font.display,
          fontSize: 36,
          fontWeight: 300,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          marginTop: 14,
          color: accent ? palette.red : theme.textStrong,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 7 }}>{unit}</div>
    </div>
  );
}

function Figures({ stats }: { stats: StatsSummary }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.25fr 1fr 1fr 1fr",
        borderTop: `1px solid ${theme.textStrong}`,
        borderBottom: `1px solid ${theme.rule}`,
        marginBottom: 28,
      }}
    >
      <Figure label="Today" value={fmtNum(stats.words_today)} unit="words dictated" accent first />
      <Figure label="Speed" value={fmtNum(stats.avg_wpm)} unit="words / minute" />
      <Figure label="Total" value={fmtCompact(stats.total_words)} unit="words, all time" />
      <Figure label="Streak" value={fmtNum(stats.day_streak)} unit={stats.day_streak === 1 ? "day" : "days in a row"} />
    </div>
  );
}

// ── Seven-day activity ───────────────────────────────────────────────────────
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function Activity({ stats }: { stats: StatsSummary }) {
  const data = stats.last7_words;
  const max = Math.max(1, ...data);
  const today = new Date().getDay();
  return (
    <Card label="Last 7 days" index={3}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 132, borderBottom: `1px solid ${theme.textStrong}` }}>
        {data.map((v, i) => {
          const isToday = i === data.length - 1;
          return (
            <div key={i} title={`${fmtNum(v)} words`} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}>
              <div
                style={{
                  width: "100%",
                  height: v > 0 ? `${Math.max(4, (v / max) * 100)}%` : 0,
                  background: isToday ? palette.red : palette.charcoal,
                  transition: "height 420ms cubic-bezier(0.2, 0.7, 0.1, 1)",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {data.map((_, i) => {
          const dow = (today - (data.length - 1 - i) + 7) % 7;
          const isToday = i === data.length - 1;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                fontFamily: font.mono,
                fontSize: 10,
                letterSpacing: "0.06em",
                color: isToday ? palette.red : theme.textFaint,
              }}
            >
              {DOW[dow]}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${theme.rule}`, display: "grid", gap: 8 }}>
        <Line label="Best speed" value={`${fmtNum(stats.best_wpm)} wpm`} />
        <Line label="Time saved vs typing" value={fmtDuration(stats.time_saved_secs)} />
        <Line label="Dictations" value={fmtNum(stats.total_sessions)} />
      </div>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: theme.textMuted }}>{label}</span>
      <span style={{ fontFamily: font.mono, fontSize: 12, color: theme.textStrong }}>{value}</span>
    </div>
  );
}

// ── Session history ──────────────────────────────────────────────────────────
type Group = { key: string; label: string; items: HistoryItem[] };

function groupByDay(items: HistoryItem[]): Group[] {
  const now = new Date();
  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (const it of items) {
    const d = new Date(it.ts_unix * 1000);
    const k = dayKey(d);
    let g = index.get(k);
    if (!g) {
      g = { key: k, label: dayLabel(d, now), items: [] };
      index.set(k, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}

// Copy one dictation back to the clipboard; shows "Copied" for a moment.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <button
      onClick={() => void copy()}
      title="Copy"
      aria-label={copied ? "Copied" : "Copy this dictation"}
      className={copied ? undefined : "koe-copy"}
      style={{
        flex: "0 0 auto",
        alignSelf: "flex-start",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 6,
        // Room for "Copied" up front, so the text beside it never re-wraps.
        width: 88,
        padding: "3px 6px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        // Idle colours (faint, darker on hover) live in the .koe-copy class.
        color: copied ? palette.red : undefined,
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {copied && <Eyebrow color={palette.red}>Copied</Eyebrow>}
    </button>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  return (
    <div className="koe-row" style={{ display: "flex", gap: 18, padding: "12px 2px", borderTop: `1px solid ${theme.rule}` }}>
      <div
        style={{
          flex: "0 0 62px",
          fontFamily: font.mono,
          fontSize: 11,
          color: theme.textFaint,
          paddingTop: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtTimeOfDay(new Date(item.ts_unix * 1000))}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: theme.textBody, userSelect: "text" }}>{item.text}</div>
        {item.app && (
          <Eyebrow style={{ marginTop: 6, fontSize: 10 }}>{appName(item.app)}</Eyebrow>
        )}
      </div>
      <CopyButton text={item.text} />
    </div>
  );
}

function History({ history }: { history: HistoryItem[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? history.filter((h) => h.text.toLowerCase().includes(q)) : history;
  const groups = groupByDay(filtered);

  return (
    <Card pad={0} style={{ minHeight: 320 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px 14px" }}>
        <Eyebrow index={2}>This session</Eyebrow>
        {history.length > 0 && (
          <div style={{ position: "relative", width: 200 }}>
            <Icon
              name="search"
              size={14}
              style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: theme.textFaint }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search this session"
              style={{ ...inputStyle, padding: "6px 10px 6px 28px", fontSize: 12.5 }}
            />
          </div>
        )}
      </div>

      {history.length === 0 ? (
        <div style={{ position: "relative", margin: "0 22px 22px", padding: "52px 24px", border: `1px dashed ${theme.ruleStrong}` }}>
          <WovenGrid opacity={0.6} />
          <div style={{ position: "relative", textAlign: "center" }}>
            <div style={{ fontSize: 15, color: theme.textStrong, fontWeight: 500 }}>Nothing dictated yet.</div>
            <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 6 }}>
              What you say appears here so you can copy it again.
            </div>
            <Eyebrow style={{ marginTop: 18 }}>Kept in memory only · cleared when Koe quits</Eyebrow>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: "36px 22px", textAlign: "center", color: theme.textFaint, fontSize: 13 }}>
          Nothing matches “{query}”.
        </div>
      ) : (
        <div style={{ padding: "0 22px 18px" }}>
          {groups.map((g) => (
            <div key={g.key} style={{ marginTop: 6 }}>
              {groups.length > 1 && <Eyebrow style={{ margin: "14px 0 8px" }}>{g.label}</Eyebrow>}
              {g.items.map((it, i) => (
                <HistoryRow key={`${it.ts_unix}-${i}`} item={it} />
              ))}
            </div>
          ))}
          <Eyebrow style={{ marginTop: 16 }}>Kept in memory only · cleared when Koe quits</Eyebrow>
        </div>
      )}
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function Home({ hotkey }: { hotkey: string }) {
  const stats = useStats();
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => getHistory().then((h) => alive && setHistory(h));
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div>
      <Header hotkey={hotkey} />
      <Figures stats={stats} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(240px, 1fr)", gap: 20, alignItems: "start" }}>
        <History history={history} />
        <Activity stats={stats} />
      </div>
    </div>
  );
}
