import type { CSSProperties } from "react";

// Tiny inline-SVG icon set (no icon libraries). Stroke-based, inherits
// currentColor so callers control tint via `style.color`.

export type IconName = "search" | "plus" | "close";

const PATHS: Record<IconName, string[]> = {
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.6-3.6"],
  plus: ["M12 5v14", "M5 12h14"],
  close: ["M6 6l12 12", "M18 6L6 18"],
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      style={{ flex: "0 0 auto", ...style }}
      aria-hidden
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
