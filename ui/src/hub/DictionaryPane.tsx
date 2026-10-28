import { useEffect, useState } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Button, Card, Eyebrow, PageTitle, inputStyle } from "./ui";
import { Icon } from "./icons";
import { addDictionaryEntry, getDictionary, removeDictionaryEntry, type DictEntry } from "./api";

function AddForm({ onDone }: { onDone: () => void }) {
  const [correct, setCorrect] = useState("");
  const [heard, setHeard] = useState("");

  const submit = async () => {
    const word = correct.trim();
    if (!word) return;
    const mishears = heard
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await addDictionaryEntry(word, mishears);
    onDone();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") onDone();
  };

  return (
    <Card label="New word" style={{ marginBottom: 20, borderTop: `2px solid ${palette.red}` }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14 }}>
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 6 }}>Spell it as</span>
          <input
            autoFocus
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            placeholder="e.g. Kubernetes"
            style={inputStyle}
            onKeyDown={onKeyDown}
          />
        </label>
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, color: theme.textMuted, display: "block", marginBottom: 6 }}>
            Also heard as <span style={{ color: theme.textFaint }}>— optional, comma-separated</span>
          </span>
          <input
            value={heard}
            onChange={(e) => setHeard(e.target.value)}
            placeholder="cooper netties, cube or Nettie's"
            style={inputStyle}
            onKeyDown={onKeyDown}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Button variant="ink" onClick={() => void submit()}>
          Add word
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function EntryRow({ entry, n, onRemove }: { entry: DictEntry; n: number; onRemove: () => void }) {
  return (
    <div
      className="koe-row"
      style={{ display: "flex", alignItems: "center", gap: 18, padding: "13px 4px", borderTop: `1px solid ${theme.rule}` }}
    >
      <span style={{ flex: "0 0 28px", fontFamily: font.mono, fontSize: 10.5, color: theme.textFaint }}>
        {String(n).padStart(3, "0")}
      </span>
      <span style={{ flex: "0 0 auto", fontSize: 14.5, fontWeight: 600, color: theme.textStrong, letterSpacing: "-0.01em" }}>
        {entry.correct}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {entry.mishears.length > 0 && (
          <>
            <span style={{ fontFamily: font.mono, fontSize: 10.5, color: theme.textFaint, marginRight: 8 }}>← HEARD AS</span>
            {entry.mishears.join(", ")}
          </>
        )}
      </span>
      <button
        onClick={onRemove}
        title={`Remove ${entry.correct}`}
        aria-label={`Remove ${entry.correct}`}
        className="koe-row-action"
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: theme.textMuted,
          opacity: 0,
          transition: "opacity 140ms",
          display: "flex",
          padding: 4,
        }}
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

export function DictionaryPane() {
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const load = () => getDictionary().then(setEntries);
  useEffect(() => {
    void load();
  }, []);

  const remove = async (correct: string) => {
    await removeDictionaryEntry(correct);
    await load();
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => e.correct.toLowerCase().includes(q) || e.mishears.some((m) => m.toLowerCase().includes(q)))
    : entries;

  return (
    <div style={{ maxWidth: 820 }}>
      <PageTitle
        index={2}
        eyebrow="Dictionary"
        sub="Names, jargon, and acronyms Koe should always spell your way."
        aside={
          !adding && (
            <Button variant="accent" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              Add word
            </Button>
          )
        }
      >
        Your words
      </PageTitle>

      {adding && (
        <AddForm
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      <Card pad={0}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 22px 12px" }}>
          <Eyebrow>
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </Eyebrow>
          {entries.length > 0 && (
            <div style={{ position: "relative", width: 220 }}>
              <Icon
                name="search"
                size={14}
                style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: theme.textFaint }}
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search words"
                aria-label="Search words"
                style={{ ...inputStyle, padding: "6px 10px 6px 28px", fontSize: 12.5 }}
              />
            </div>
          )}
        </div>
        <div style={{ padding: "0 22px 14px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "34px 4px 24px", borderTop: `1px solid ${theme.rule}`, color: theme.textFaint, fontSize: 13 }}>
              {entries.length === 0
                ? "No words yet. Add the names and terms Koe should never get wrong."
                : `Nothing matches “${query}”.`}
            </div>
          ) : (
            filtered.map((e, i) => <EntryRow key={e.correct} n={i + 1} entry={e} onRemove={() => void remove(e.correct)} />)
          )}
        </div>
      </Card>
    </div>
  );
}
