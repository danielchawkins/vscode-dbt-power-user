//! WebAssembly binding: `layout` returns the placeholder until the engine lands.
use graph_layout::engine;
use wasm_bindgen::prelude::wasm_bindgen;

/// Returns the placeholder engine result. Phase 1 wires the binding only.
#[wasm_bindgen]
#[must_use]
pub fn layout() -> u32 {
    engine::PLACEHOLDER
}
