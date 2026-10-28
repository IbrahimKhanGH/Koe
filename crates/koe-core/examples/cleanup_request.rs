//! Prints the exact cleanup request Koe sends its local model for a transcript,
//! so a model or prompt change can be tried without dictating:
//!
//! ```sh
//! cargo run -q -p koe-core --example cleanup_request -- "um so meet at 2 no wait 3" \
//!   | target/release/koe-llm-worker ~/Library/Application\ Support/Koe/models/<model> [--no-think]
//! ```
//!
//! Add `--no-think` for models marked `hybrid` in models/manifest.json.

use koe_core::cleanup::{build_messages, pre_normalize_layout, CleanupContext, CleanupLevel};

fn main() {
    let raw = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let raw = pre_normalize_layout(&raw);
    let ctx = CleanupContext { level: CleanupLevel::Light, ..Default::default() };
    let messages = build_messages(&raw, &ctx);
    // Same output budget as the app (src-tauri/src/local_llm.rs).
    let max_tokens = (raw.chars().count() / 2).max(400);
    println!("{}", serde_json::json!({ "messages": messages, "max_tokens": max_tokens }));
}
