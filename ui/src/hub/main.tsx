import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { font, motion, palette } from "../tokens/values";

const style = document.createElement("style");
style.textContent = `
  html, body, #root { margin: 0; height: 100%; }
  * { box-sizing: border-box; }
  body {
    background: ${palette.ivory};
    color: ${palette.charcoal};
    font-family: ${font.ui};
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::selection { background: rgba(214, 36, 41, 0.18); }
  input::placeholder { color: ${palette.ash}; }
  button, input { font: inherit; color: inherit; }
  button:focus-visible, input:focus-visible, [role="button"]:focus-visible {
    outline: 1px solid ${palette.ink};
    outline-offset: 2px;
  }
  ::-webkit-scrollbar { width: 9px; height: 9px; }
  ::-webkit-scrollbar-thumb { background: ${palette.rule}; border: 3px solid ${palette.ivory}; }

  .koe-btn { border: 1px solid transparent; transition: background ${motion.fast}ms, border-color ${motion.fast}ms, color ${motion.fast}ms; }
  .koe-btn-ink { background: ${palette.ink}; color: ${palette.ivory}; }
  .koe-btn-ink:hover:not(:disabled) { background: ${palette.charcoal}; }
  .koe-btn-accent { background: ${palette.red}; color: #fff; }
  .koe-btn-accent:hover:not(:disabled) { background: ${palette.redDeep}; }
  .koe-btn-ghost { background: transparent; color: ${palette.ink}; border-color: ${palette.ruleStrong}; }
  .koe-btn-ghost:hover:not(:disabled) { border-color: ${palette.ink}; }
  .koe-seg:hover { background: rgba(18, 18, 17, 0.05) !important; color: ${palette.ink} !important; }
  .koe-nav:hover { color: ${palette.ink} !important; }
  .koe-row:hover { background: rgba(18, 18, 17, 0.025); }
  .koe-row:hover .koe-row-action { opacity: 1 !important; }

  /* A part sliding into its seat. Set --dx/--dy on the element. */
  @keyframes koe-assemble {
    from { transform: translate(var(--dx, 0), var(--dy, 0)); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  /* A thread drawn across the loom. Set stroke-dasharray/--len on the path. */
  @keyframes koe-draw {
    from { stroke-dashoffset: var(--len, 400); }
    to { stroke-dashoffset: 0; }
  }
  @keyframes koe-rise {
    from { transform: translateY(6px); opacity: 0; }
    to { transform: none; opacity: 1; }
  }
  .koe-rise { animation: koe-rise ${motion.base * 1.6}ms ${motion.ease} both; }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 1ms !important;
      animation-delay: 0ms !important;
      transition-duration: 1ms !important;
    }
  }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
