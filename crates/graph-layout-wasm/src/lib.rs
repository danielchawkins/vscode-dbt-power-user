//! WebAssembly binding: `layout` takes a graph frame and returns a layout frame. The hello stub returns an empty layout
//! until the engine lands.
use graph_layout::engine;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};

/// Takes a graph frame (ADR 0011, Decision 6) and returns the layout frame.
///
/// # Errors
///
/// Throws when `graph` is not a graph frame of this version.
#[wasm_bindgen]
pub fn layout(graph: &[u8]) -> Result<Vec<u8>, JsError> {
    engine::layout_frame(graph).map_err(|error| JsError::new(&error.to_string()))
}
