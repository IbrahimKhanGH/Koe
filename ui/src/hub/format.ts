// Small, framework-free formatting helpers used across the Hub.

// 12345 -> "12.3K", 1_200_000 -> "1.2M", 940 -> "940".
export function fmtCompact(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return strip(n / 1000) + "K";
  return strip(n / 1_000_000) + "M";
}

function strip(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1);
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

export function fmtDuration(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "9:41 am"
export function fmtTimeOfDay(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ap}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Section header for a history group: "Today" / "Yesterday" / "Jul 15".
export function dayLabel(d: Date, now: Date = new Date()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const ACCELERATOR_SYMBOLS: Record<string, string> = {
  CmdOrCtrl: "⌘",
  Cmd: "⌘",
  Command: "⌘",
  Super: "⌘",
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

// "CmdOrCtrl+Shift+Space" -> "⌘ ⇧ Space"; empty -> "Off".
export function prettyAccelerator(accelerator: string): string {
  if (!accelerator.trim()) return "Off";
  return accelerator
    .split("+")
    .map((part) => ACCELERATOR_SYMBOLS[part] ?? part)
    .join(" ");
}

// Bundle id -> a readable app name: known apps by name, otherwise the id's last
// segment ("com.example.FooBar" -> "FooBar").
const APP_NAMES: Record<string, string> = {
  "com.tinyspeck.slackmacgap": "Slack",
  "com.apple.mail": "Mail",
  "com.microsoft.VSCode": "VS Code",
  "com.microsoft.Outlook": "Outlook",
  "com.microsoft.teams2": "Teams",
  "com.microsoft.Word": "Word",
  "com.google.Chrome": "Chrome",
  "com.apple.Safari": "Safari",
  "com.apple.Notes": "Notes",
  "com.apple.MobileSMS": "Messages",
  "com.apple.Terminal": "Terminal",
  "com.googlecode.iterm2": "iTerm",
  "notion.id": "Notion",
  "com.todesktop.230313mzl4w4u92": "Cursor",
};

export function appName(bundleId: string): string {
  return APP_NAMES[bundleId] ?? bundleId.split(".").pop() ?? bundleId;
}
