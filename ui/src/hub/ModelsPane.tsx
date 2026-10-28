import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Eyebrow, PageTitle } from "./ui";
import { getModels, restartApp, type ModelInfo, type ModelKind, type ModelsReport, type Settings, type Tier } from "./api";

const TIERS: { key: Tier; name: string; blurb: string }[] = [
  { key: "compact", name: "Compact", blurb: "Speech only. Pastes what you said, with punctuation; no rewriting." },
  { key: "balanced", name: "Balanced", blurb: "Best accuracy for the size. The default." },
  { key: "max", name: "Max", blurb: "Strongest cleanup and rewriting. Needs 32 GB of memory or more." },
];

const KINDS: { kind: ModelKind; setting: "speech_model" | "cleanup_model"; title: string; desc: string }[] = [
  {
    kind: "whisper",
    setting: "speech_model",
    title: "Speech",
    desc: "Turns your voice into text. Bigger models get names, jargon, and accents right more often.",
  },
  {
    kind: "cleanup",
    setting: "cleanup_model",
    title: "Cleanup",
    desc: "Removes fillers, applies your self-corrections, and fixes punctuation and lists before pasting.",
  },
];

function gb(bytes: number): string {
  const v = bytes / 1e9;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)} GB`;
}

// A shell command with a copy button. The app can't download models itself (it
// has no network code); this is the one line to run instead.
function Command({ cmd, wrap = false }: { cmd: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* the text stays selectable */
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "stretch", border: `1px solid ${theme.ruleStrong}`, borderRadius: 3, overflow: "hidden" }}>
      <code
        style={{
          flex: 1,
          minWidth: 0,
          padding: "7px 10px",
          fontFamily: font.mono,
          fontSize: 11.5,
          color: theme.textStrong,
          background: palette.ivory,
          whiteSpace: wrap ? "normal" : "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.5,
          userSelect: "all",
        }}
      >
        {cmd}
      </code>
      <button
        onClick={() => void copy()}
        className="koe-seg"
        style={{
          border: "none",
          borderLeft: `1px solid ${theme.ruleStrong}`,
          background: "transparent",
          cursor: "pointer",
          padding: "0 11px",
          fontFamily: font.mono,
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: copied ? palette.red : theme.textMuted,
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function TierCard({ tier, models }: { tier: (typeof TIERS)[number]; models: ModelInfo[] }) {
  const parts = models.filter((m) => m.tiers.includes(tier.key));
  const total = parts.reduce((s, m) => s + m.size, 0);
  const have = parts.filter((m) => m.installed).length;
  const complete = parts.length > 0 && have === parts.length;
  const isDefault = tier.key === "balanced";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "18px 18px 16px",
        background: theme.surface,
        border: `1px solid ${theme.rule}`,
        borderTop: `2px solid ${isDefault ? palette.red : theme.textStrong}`,
        borderRadius: 3,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em", color: theme.textStrong }}>{tier.name}</span>
        <Eyebrow color={isDefault ? palette.red : theme.textFaint}>{isDefault ? "Default" : gb(total)}</Eyebrow>
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: theme.textMuted, minHeight: 38 }}>{tier.blurb}</div>
      <div style={{ display: "grid", gap: 4 }}>
        {parts.map((m) => (
          <div key={m.file} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ color: theme.textBody }}>{m.label}</span>
            <span style={{ fontFamily: font.mono, fontSize: 11, color: theme.textFaint }}>{gb(m.size)}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "auto", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 7,
              height: 7,
              background: complete ? palette.chartreuse : "transparent",
              outline: `1px solid ${complete ? "rgba(18,18,17,0.25)" : theme.ruleStrong}`,
            }}
          />
          <Eyebrow color={theme.textMuted}>
            {complete ? "Installed" : have > 0 ? `${have} of ${parts.length} installed` : `${gb(total)} to download`}
          </Eyebrow>
        </div>
        {!complete && <Command wrap cmd={`scripts/get-models.sh --tier ${tier.key}`} />}
      </div>
    </div>
  );
}

function Status({ m }: { m: ModelInfo }) {
  if (m.failed_check) return <Eyebrow color={palette.red}>Failed check</Eyebrow>;
  if (m.active) return <Eyebrow color={palette.red}>● Loaded</Eyebrow>;
  if (m.installed) return <Eyebrow color={theme.textMuted}>Installed</Eyebrow>;
  return <Eyebrow>Not installed</Eyebrow>;
}

function Choice({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={disabled || selected ? undefined : "koe-seg"}
      style={{
        display: "grid",
        gridTemplateColumns: "14px minmax(0, 1fr) auto",
        alignItems: "start",
        gap: 14,
        width: "100%",
        textAlign: "left",
        padding: "14px 16px",
        border: "none",
        borderTop: `1px solid ${theme.rule}`,
        background: selected ? "rgba(214, 36, 41, 0.05)" : "transparent",
        boxShadow: selected ? `inset 2px 0 0 ${palette.red}` : "none",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          marginTop: 4,
          background: selected ? palette.red : "transparent",
          border: `1px solid ${selected ? palette.red : theme.ruleStrong}`,
          opacity: disabled ? 0.4 : 1,
        }}
      />
      {children}
    </button>
  );
}

function KindSection({
  index,
  def,
  models,
  value,
  onChange,
}: {
  index: number;
  def: (typeof KINDS)[number];
  models: ModelInfo[];
  value: string | null;
  onChange: (file: string | null) => void;
}) {
  const list = models.filter((m) => m.kind === def.kind);
  const best = list.find((m) => m.installed && !m.failed_check);
  const chosen = list.find((m) => m.file === value);
  const chosenUnusable = chosen && (!chosen.installed || chosen.failed_check);
  return (
    <Card pad={0} style={{ marginBottom: 20 }}>
      <div style={{ padding: "18px 18px 14px" }}>
        <Eyebrow index={index}>{def.title}</Eyebrow>
        <div style={{ fontSize: 13, color: theme.textMuted, marginTop: 8, lineHeight: 1.5 }}>{def.desc}</div>
        {chosenUnusable && (
          <div style={{ fontSize: 12.5, color: palette.red, marginTop: 10, paddingLeft: 10, borderLeft: `2px solid ${palette.red}` }}>
            Your choice, {chosen.label}, {chosen.failed_check ? "failed its fingerprint check" : "isn't installed"} —
            using {best ? best.label : "nothing"} until it is.
          </div>
        )}
      </div>
      <div role="radiogroup" aria-label={`${def.title} model`}>
        <Choice selected={value === null} onSelect={() => onChange(null)}>
          <span>
            <span style={{ fontSize: 14, fontWeight: 600, color: theme.textStrong }}>Automatic</span>
            <span style={{ display: "block", fontSize: 12.5, color: theme.textMuted, marginTop: 3 }}>
              The best one installed{best ? ` — now ${best.label}` : ""}.
            </span>
          </span>
          <span />
        </Choice>
        {list.map((m) => (
          <Choice
            key={m.file}
            selected={value === m.file}
            disabled={!m.installed}
            onSelect={() => m.installed && onChange(m.file)}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: m.installed ? theme.textStrong : theme.textMuted }}>
                  {m.label}
                </span>
                <span style={{ fontFamily: font.mono, fontSize: 11, color: theme.textFaint }}>
                  {gb(m.size)} · ~{m.ram_gb} GB memory
                </span>
              </span>
              <span style={{ display: "block", fontSize: 12.5, color: theme.textMuted, marginTop: 3 }}>{m.note}</span>
              {!m.installed && (
                <span style={{ display: "block", marginTop: 10, maxWidth: 440 }}>
                  <Command cmd={`scripts/get-models.sh ${m.file}`} />
                </span>
              )}
            </span>
            <Status m={m} />
          </Choice>
        ))}
      </div>
    </Card>
  );
}

// What each kind should be running given the choice: the chosen model if it's
// usable, otherwise the best one installed.
function wanted(models: ModelInfo[], kind: ModelKind, choice: string | null): ModelInfo | undefined {
  const usable = models.filter((m) => m.kind === kind && m.installed && !m.failed_check);
  return usable.find((m) => m.file === choice) ?? usable[0];
}

export function ModelsPane({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [report, setReport] = useState<ModelsReport>({ dir: "", models: [] });

  useEffect(() => {
    let alive = true;
    // Polls so models installed by the script appear without reopening the page.
    const load = () => getModels().then((r) => alive && setReport(r));
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const models = report.models;
  const pending = KINDS.map((k) => {
    const want = wanted(models, k.kind, settings[k.setting]);
    const active = models.find((m) => m.kind === k.kind && m.active);
    return want && want.file !== active?.file ? want : undefined;
  }).filter((m): m is ModelInfo => !!m);

  return (
    <div style={{ maxWidth: 980 }}>
      <PageTitle
        index={3}
        eyebrow="Models"
        sub="Two models do the work, both on this Mac. Each is checked against a pinned fingerprint before it loads."
      >
        What runs here
      </PageTitle>

      {pending.length > 0 && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "12px 16px",
            marginBottom: 22,
            background: theme.accentWash,
            borderLeft: `3px solid ${palette.red}`,
          }}
        >
          <span style={{ fontSize: 13, color: theme.textBody }}>
            Restart Koe to load <b>{pending.map((m) => m.label).join(" and ")}</b>.
          </span>
          <Button variant="accent" size="sm" onClick={() => void restartApp()}>
            Restart now
          </Button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14, marginBottom: 30 }}>
        {TIERS.map((t) => (
          <TierCard key={t.key} tier={t} models={models} />
        ))}
      </div>

      {KINDS.map((k, i) => (
        <KindSection
          key={k.kind}
          index={i + 1}
          def={k}
          models={models}
          value={settings[k.setting]}
          onChange={(file) => onChange({ ...settings, [k.setting]: file })}
        />
      ))}

      <div style={{ fontSize: 12.5, color: theme.textMuted, lineHeight: 1.7 }}>
        Koe never downloads anything itself. Run a command above from the Koe folder, or install files someone already
        downloaded with{" "}
        <code style={{ fontFamily: font.mono, fontSize: 11.5, whiteSpace: "nowrap" }}>scripts/get-models.sh --from FOLDER</code>.
        {report.dir && (
          <>
            <br />
            Models folder: <code style={{ fontFamily: font.mono, fontSize: 11.5, userSelect: "all" }}>{report.dir}</code>
          </>
        )}
      </div>
    </div>
  );
}
