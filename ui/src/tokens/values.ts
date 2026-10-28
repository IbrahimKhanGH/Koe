// Koe 声 design tokens — Japanese industrial heritage × modern digital precision.
// Warm ivory and charcoal, one industrial red, and three signal colors used
// sparingly. Single source of truth for the Hub, the pill, and the waveform canvas.

export const palette = {
  // Paper.
  ivory: "#F4F0E6",
  paper: "#FAF7F0",
  bone: "#EBE5D8",

  // Ink.
  ink: "#121211",
  charcoal: "#2B2A27",
  graphite: "#55524B",
  slate: "#8A857A",
  ash: "#B5AFA2",

  // Hairlines.
  rule: "#DDD6C6",
  ruleStrong: "#C2BAA8",

  // Industrial red (primary accent) and the three signal colors.
  red: "#D62429",
  redDeep: "#B11B20",
  magenta: "#EC008D",
  powder: "#A4C7DD",
  chartreuse: "#C4C529",

  // Semantic.
  error: "#D62429",
  success: "#5F6B1E", // chartreuse, deepened until it reads as text on ivory
} as const;

// The floating pill: a machined black plate.
export const pillFill = {
  base: palette.ink,
  border: "rgba(244,240,230,0.12)",
  shadow: "0 3px 9px rgba(18,18,17,0.32)", // small: the overlay window is only 72px tall
  text: palette.ivory,
  textMuted: "#A9A497",
} as const;

export const geometry = {
  morphMs: 360,
  radius: 3, // the one corner radius for surfaces and controls
} as const;

export const motion = {
  // Decisive start, soft landing: a part seating into place.
  ease: "cubic-bezier(0.2, 0.7, 0.1, 1)",
  fast: 140,
  base: 260,
  assemble: 620,
} as const;

// System fonts only: the app may load nothing from the network, and these ship
// with every Mac. Helvetica Neue carries the Swiss editorial voice, Hiragino
// Mincho sets 声, and SF Mono handles technical labels and figures.
export const font = {
  ui: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mincho: '"Hiragino Mincho ProN", "Yu Mincho", "Songti SC", serif',
  mono: '"SF Mono", ui-monospace, Menlo, monospace',
} as const;
