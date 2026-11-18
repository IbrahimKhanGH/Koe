//! What a dictation binding string means. The hold (push-to-talk) and toggle
//! (hands-free) bindings are both stored in [`crate::Settings`] as strings in
//! one small grammar, so either can be the Fn key, a keyboard shortcut, or a
//! mouse button:
//!
//! - `""`: off
//! - `"Fn"`: the Fn / Globe key
//! - `"Mouse3"`, `"Mouse4"`, `"Ctrl+Mouse5"`: a mouse button, optionally with
//!   modifiers. Numbered the way mice are sold: 3 is the middle button, 4 and 5
//!   the side buttons. Left and right click (1 and 2) can never be bound.
//! - anything else: a keyboard accelerator (`"CmdOrCtrl+Shift+Space"`, `"F13"`)
//!   that the platform's global-shortcut layer parses and registers.

/// The modifier keys held with a mouse-button binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Mods {
    pub cmd: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// A parsed binding string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// Unbound.
    Off,
    /// The Fn / Globe key.
    Fn,
    /// A mouse button, as sold (3 = middle, 4 and 5 = side buttons, …).
    Mouse { button: u8, mods: Mods },
    /// A keyboard accelerator, kept as written for the global-shortcut layer.
    Keys(String),
}

/// The lowest and highest mouse buttons that may be bound. 1 and 2 are left and
/// right click: binding either would take the mouse away from the user.
pub const MOUSE_BUTTON_MIN: u8 = 3;
pub const MOUSE_BUTTON_MAX: u8 = 32;

impl Binding {
    /// Read a binding string. Never fails: text that isn't Fn or a mouse button
    /// is taken to be a keyboard accelerator, which the shortcut layer validates
    /// when it registers it.
    pub fn parse(text: &str) -> Binding {
        let text = text.trim();
        if text.is_empty() {
            return Binding::Off;
        }
        if text.eq_ignore_ascii_case("fn") {
            return Binding::Fn;
        }
        let mut parts: Vec<&str> = text.split('+').map(str::trim).collect();
        let key = parts.pop().unwrap_or_default();
        if let Some(button) = mouse_button(key) {
            let mut mods = Mods::default();
            for part in parts {
                match part.to_ascii_lowercase().as_str() {
                    "cmdorctrl" | "cmd" | "command" | "super" => mods.cmd = true,
                    "ctrl" | "control" => mods.ctrl = true,
                    "alt" | "option" => mods.alt = true,
                    "shift" => mods.shift = true,
                    _ => return Binding::Keys(text.to_string()),
                }
            }
            return Binding::Mouse { button, mods };
        }
        Binding::Keys(text.to_string())
    }

    /// The canonical string for a mouse button with modifiers, as the capture
    /// path reports it and [`Binding::parse`] reads it back.
    pub fn mouse_string(button: u8, mods: Mods) -> String {
        let mut out = String::new();
        if mods.cmd {
            out.push_str("CmdOrCtrl+");
        }
        if mods.ctrl {
            out.push_str("Ctrl+");
        }
        if mods.alt {
            out.push_str("Alt+");
        }
        if mods.shift {
            out.push_str("Shift+");
        }
        out.push_str(&format!("Mouse{button}"));
        out
    }
}

fn mouse_button(key: &str) -> Option<u8> {
    let lower = key.to_ascii_lowercase();
    let n: u8 = lower.strip_prefix("mouse")?.parse().ok()?;
    (MOUSE_BUTTON_MIN..=MOUSE_BUTTON_MAX).contains(&n).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_is_off_and_fn_is_fn() {
        assert_eq!(Binding::parse(""), Binding::Off);
        assert_eq!(Binding::parse("  "), Binding::Off);
        assert_eq!(Binding::parse("Fn"), Binding::Fn);
        assert_eq!(Binding::parse("fn"), Binding::Fn);
    }

    #[test]
    fn mouse_buttons_parse_with_and_without_modifiers() {
        assert_eq!(Binding::parse("Mouse4"), Binding::Mouse { button: 4, mods: Mods::default() });
        assert_eq!(
            Binding::parse("Ctrl+Shift+Mouse5"),
            Binding::Mouse { button: 5, mods: Mods { ctrl: true, shift: true, ..Default::default() } }
        );
    }

    #[test]
    fn left_and_right_click_are_never_mouse_bindings() {
        for text in ["Mouse1", "Mouse2", "Mouse0", "Mouse99"] {
            assert!(matches!(Binding::parse(text), Binding::Keys(_)), "{text}");
        }
    }

    #[test]
    fn keyboard_accelerators_pass_through_as_written() {
        assert_eq!(
            Binding::parse("CmdOrCtrl+Shift+Space"),
            Binding::Keys("CmdOrCtrl+Shift+Space".to_string())
        );
        assert_eq!(Binding::parse("F13"), Binding::Keys("F13".to_string()));
    }

    #[test]
    fn mouse_string_round_trips() {
        let mods = Mods { cmd: true, alt: true, ..Default::default() };
        let text = Binding::mouse_string(4, mods);
        assert_eq!(text, "CmdOrCtrl+Alt+Mouse4");
        assert_eq!(Binding::parse(&text), Binding::Mouse { button: 4, mods });
        assert_eq!(Binding::mouse_string(3, Mods::default()), "Mouse3");
    }
}
