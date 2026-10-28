import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Card, Eyebrow, Key, PageTitle } from "./ui";
import { getModels, type ModelsReport } from "./api";

// ── The path your voice takes ────────────────────────────────────────────────
// Four stations inside a frame labeled "This Mac", joined by a red thread, and
// the internet outside it with nothing reaching it.
function Station({ n, title, detail }: { n: number; title: string; detail: string }) {
  return (
    <div style={{ position: "relative", background: theme.surface, border: `1px solid ${theme.ruleStrong}`, padding: "14px 14px 12px" }}>
      <span style={{ fontFamily: font.mono, fontSize: 10.5, color: palette.red }}>{String(n).padStart(2, "0")}</span>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong, marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 4, lineHeight: 1.45 }}>{detail}</div>
    </div>
  );
}

function VoicePath() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 132px", gap: 16, alignItems: "stretch", marginBottom: 34 }}>
      <div style={{ position: "relative", border: `1px solid ${theme.textStrong}`, padding: "30px 18px 18px" }}>
        <Eyebrow style={{ position: "absolute", top: -7, left: 14, background: theme.pageBg, padding: "0 8px", color: theme.textStrong }}>
          This Mac
        </Eyebrow>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
          {/* The thread running through every station. */}
          <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: palette.red }} />
          <Station n={1} title="Microphone" detail="Records only while you hold the key or the toggle is on." />
          <Station n={2} title="Speech model" detail="Whisper turns audio into text. Audio is discarded." />
          <Station n={3} title="Cleanup model" detail="Qwen tidies the text: fillers, corrections, lists." />
          <Station n={4} title="Your cursor" detail="Pasted where you're typing, then the clipboard is restored." />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 8,
          border: `1px dashed ${theme.ruleStrong}`,
          color: theme.textFaint,
          textAlign: "center",
          padding: 12,
        }}
      >
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
          <circle cx="17" cy="17" r="13" fill="none" stroke={palette.slate} strokeWidth="1.2" />
          <ellipse cx="17" cy="17" rx="6" ry="13" fill="none" stroke={palette.slate} strokeWidth="1.2" />
          <line x1="4" y1="17" x2="30" y2="17" stroke={palette.slate} strokeWidth="1.2" />
          <line x1="5" y1="29" x2="29" y2="5" stroke={palette.red} strokeWidth="2.4" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.textMuted }}>Internet</span>
        <Eyebrow color={palette.red}>Never</Eyebrow>
      </div>
    </div>
  );
}

// ── Facts ────────────────────────────────────────────────────────────────────
const FACTS: { title: string; body: ReactNode }[] = [
  {
    title: "No network code",
    body: (
      <>
        Koe contains no code that can connect to the internet: no web client, no analytics, no crash reporter, no
        updater. Every build is checked for this and fails if any of it appears. Its windows are locked so they
        can't load anything from the web either.
      </>
    ),
  },
  {
    title: "Nothing you say is kept",
    body: (
      <>
        Audio is thrown away once it's transcribed. Text isn't written to disk or to logs; the session list on Home
        lives in memory and clears when Koe quits.
      </>
    ),
  },
  {
    title: "A private paste",
    body: (
      <>
        Text reaches your cursor through the clipboard, marked as this-Mac-only so it never syncs to your phone over
        Universal Clipboard, and as private so clipboard managers skip it. Your previous clipboard is put back.
      </>
    ),
  },
  {
    title: "Verified models",
    body: (
      <>
        Each model is pinned to an exact file from its maker's official page. Koe checks the file's SHA-256
        fingerprint before every load and refuses anything that doesn't match. Downloads happen in a Terminal window
        you can watch, never inside Koe.
      </>
    ),
  },
  {
    title: "Permissions, and why",
    body: (
      <>
        <b>Microphone</b> to hear you. <b>Accessibility</b> to type into other apps and see the <Key>fn</Key> key.{" "}
        <b>Input Monitoring</b> (optional) for more reliable key detection. Nothing else.
      </>
    ),
  },
];

// ── What's on disk ───────────────────────────────────────────────────────────
const STORED: { file: string; what: string }[] = [
  { file: "settings.json", what: "Your choices in Settings and Models" },
  { file: "dictionary.json", what: "Words you added to Dictionary" },
  { file: "stats.json", what: "Word counts, speaking time, dates, which app was in front. Never the words." },
  { file: "models/", what: "The speech and cleanup models" },
];

export function PrivacyPane() {
  const [report, setReport] = useState<ModelsReport>({ dir: "", models: [] });
  useEffect(() => {
    void getModels().then(setReport);
  }, []);
  const loaded = report.models.filter((m) => m.active);
  const folder = report.dir.replace(/\/models$/, "") || "~/Library/Application Support/Koe";

  return (
    <div style={{ maxWidth: 980 }}>
      <PageTitle
        index={6}
        eyebrow="Privacy"
        sub="Koe was built for confidential work. Here is exactly what happens to what you say."
      >
        Nothing leaves this Mac.
      </PageTitle>

      <VoicePath />

      <ol style={{ listStyle: "none", padding: 0, margin: "0 0 34px" }}>
        {FACTS.map((f, i) => (
          <li
            key={f.title}
            style={{
              display: "grid",
              gridTemplateColumns: "56px minmax(170px, 0.8fr) minmax(0, 2fr)",
              gap: 20,
              padding: "18px 0",
              borderTop: `1px solid ${i === 0 ? theme.textStrong : theme.rule}`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: 11, color: palette.red, paddingTop: 3 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong, letterSpacing: "-0.01em" }}>{f.title}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.7, color: theme.textMuted }}>{f.body}</span>
          </li>
        ))}
      </ol>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <Card label="What's on disk">
          <div style={{ paddingBottom: 6, fontFamily: font.mono, fontSize: 11, color: theme.textFaint, wordBreak: "break-all" }}>
            {folder}
          </div>
          <div style={{ paddingTop: 6 }}>
            {STORED.map((s) => (
              <div key={s.file} style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr)", gap: 14, padding: "10px 0", borderTop: `1px solid ${theme.rule}` }}>
                <span style={{ fontFamily: font.mono, fontSize: 12, color: theme.textStrong }}>{s.file}</span>
                <span style={{ fontSize: 12.5, color: theme.textMuted, lineHeight: 1.5 }}>{s.what}</span>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "grid", gap: 20 }}>
          <Card label="Loaded now">
            {loaded.length === 0 ? (
              <div style={{ fontSize: 13, color: theme.textMuted }}>No models loaded yet. See Models.</div>
            ) : (
              loaded.map((m) => (
                <div key={m.file} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                  <span style={{ width: 7, height: 7, background: palette.chartreuse, outline: "1px solid rgba(18,18,17,0.25)" }} />
                  <span style={{ flex: 1, fontSize: 13, color: theme.textStrong }}>{m.label}</span>
                  <Eyebrow color={theme.textMuted}>SHA-256 verified</Eyebrow>
                </div>
              ))
            )}
          </Card>

          <Card label="Check it yourself">
            <div style={{ fontSize: 13, color: theme.textMuted, lineHeight: 1.65 }}>
              Open <b>Activity Monitor</b>, choose the <b>Network</b> tab, and search “Koe”: bytes sent stay at zero
              while you dictate. Or block Koe entirely with a firewall such as LuLu; it keeps working, because it
              never needs the network.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
