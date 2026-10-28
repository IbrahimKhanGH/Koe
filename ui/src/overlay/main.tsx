import React from "react";
import ReactDOM from "react-dom/client";
import { FlowBar } from "./FlowBar";

// The overlay window is transparent; keep the document background clear so only
// the pill paints. (Global reset lives here rather than a CSS file to keep the
// always-resident overlay bundle minimal.)
const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; height: 100%; background: transparent; }
  * { box-sizing: border-box; }
  body { -webkit-font-smoothing: antialiased; }
  .koe-pill-btn { transition: filter 140ms; }
  .koe-pill-btn:hover { filter: brightness(1.2); }
  @keyframes koe-shuttle { from { left: 0; } to { left: calc(100% - 12px); } }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FlowBar />
  </React.StrictMode>,
);
