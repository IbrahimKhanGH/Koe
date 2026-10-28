import type { ReactNode } from "react";
import { font, palette } from "../tokens/values";
import { theme } from "./theme";
import { Key, PageTitle } from "./ui";

const TOPICS: { title: string; body: ReactNode }[] = [
  {
    title: "Push to talk",
    body: (
      <>
        Hold <Key>fn</Key>, speak, release. Your words are cleaned up on-device and typed wherever the cursor
        is — mail, chat, docs, code.
      </>
    ),
  },
  {
    title: "Hands-free",
    body: (
      <>
        Press the toggle shortcut (<Key>⌘ ⇧ Space</Key> unless you changed it) or double-tap <Key>fn</Key> to
        start; press it again to stop and paste. Change the shortcut in Settings.
      </>
    ),
  },
  {
    title: "The pill",
    body: (
      <>
        While you speak, a small bar at the bottom of the screen shows your voice. <Key>■</Key> stops and
        pastes; <Key>✕</Key> throws the recording away.
      </>
    ),
  },
  {
    title: "Models",
    body: (
      <>
        Choose a tier on the Models page: Compact (0.5 GB, speech only), Balanced (5.9 GB, the default), or Max
        (20 GB, for Macs with 32 GB of memory or more). Koe never downloads anything itself — the page gives you the one
        command to run.
      </>
    ),
  },
  {
    title: "Your words",
    body: (
      <>
        Add names, product terms, and acronyms in Dictionary — plus how they tend to be misheard — and Koe
        spells them your way.
      </>
    ),
  },
  {
    title: "Privacy",
    body: (
      <>
        Speech recognition and cleanup both run on this Mac, and Koe contains no network code. What you dictate
        is never written to disk: the session list clears when Koe quits. Stored in{" "}
        <span style={{ fontFamily: font.mono, fontSize: 12 }}>~/Library/Application Support/Koe</span>: settings,
        your dictionary, word counts, and the models.
      </>
    ),
  },
  {
    title: "If nothing is typed",
    body: (
      <>
        Open System Settings → Privacy &amp; Security → Accessibility and make sure Koe is on. After installing
        a new build, remove it with <Key>−</Key>, add it again, and relaunch.
      </>
    ),
  },
];

export function Help() {
  return (
    <div style={{ maxWidth: 820 }}>
      <PageTitle index={5} eyebrow="Help" sub="Everything Koe does, on one page.">
        How it works
      </PageTitle>
      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {TOPICS.map((t, i) => (
          <li
            key={t.title}
            style={{
              display: "grid",
              gridTemplateColumns: "56px minmax(160px, 0.8fr) minmax(0, 2fr)",
              gap: 20,
              padding: "20px 0",
              borderTop: i === 0 ? "none" : `1px solid ${theme.rule}`,
            }}
          >
            <span style={{ fontFamily: font.mono, fontSize: 11, color: palette.red, paddingTop: 3 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: theme.textStrong, letterSpacing: "-0.01em" }}>
              {t.title}
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.75, color: theme.textMuted }}>{t.body}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
