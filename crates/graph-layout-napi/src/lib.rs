//! Node-API binding: `layout` returns the placeholder until the engine lands.
use graph_layout::engine;
use napi_derive::napi;

/// Returns the placeholder engine result. Phase 1 wires the binding only.
#[napi]
#[must_use]
pub fn layout() -> u32 {
    engine::PLACEHOLDER
}
