//! Menu-path matching shared by every platform's menu backend: which item a
//! requested label names, and whether it may be invoked as a command.

use crate::error::CoreResult;

/// One immediate child of a native application menu. `path` holds the native
/// labels, ellipses included; selection accepts normalized labels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub title: String,
    pub path: Vec<String>,
    pub enabled: bool,
    pub checked: bool,
    pub has_submenu: bool,
    pub shortcut: Option<String>,
}

pub fn validate_path(_path: &[String], _allow_empty: bool) -> CoreResult<()> {
    unimplemented!()
}

pub fn match_index(_items: &[MenuItem], _label: &str) -> CoreResult<usize> {
    unimplemented!()
}

pub fn require_command(_item: &MenuItem) -> CoreResult<()> {
    unimplemented!()
}

#[cfg(test)]
mod tests;
