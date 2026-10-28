// Semantic roles for the Hub window, mapped onto the Koe palette. Components
// use these names; the palette only appears here and in the motifs.

import { palette } from "../tokens/values";

export const theme = {
  // Surfaces
  pageBg: palette.ivory,
  sidebarBg: palette.paper,
  surface: palette.paper,
  surfaceSunk: palette.bone,
  hover: "rgba(18,18,17,0.04)",

  // Hairlines
  rule: palette.rule,
  ruleStrong: palette.ruleStrong,

  // Text
  textStrong: palette.ink,
  textBody: palette.charcoal,
  textMuted: palette.graphite,
  textFaint: palette.slate,

  // Accent
  accent: palette.red,
  accentDeep: palette.redDeep,
  accentWash: "rgba(214,36,41,0.07)",
  accentRule: "rgba(214,36,41,0.35)",

  // Focus ring: a thin ink outline, offset like a machined edge.
  focus: `0 0 0 1px ${palette.paper}, 0 0 0 2px ${palette.ink}`,
} as const;
