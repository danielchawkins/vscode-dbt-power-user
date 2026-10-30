//! Node-API binding: `layout` takes a graph frame and returns a layout frame. The hello stub returns an empty layout
//! until the engine lands.
use graph_layout::engine;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// Takes a graph frame (ADR 0011, Decision 6) and returns the layout frame.
///
/// # Errors
///
/// Fails when `graph` is not a graph frame of this version.
#[napi]
pub fn layout(graph: &[u8]) -> napi::Result<Buffer> {
    engine::layout_frame(graph)
        .map(Buffer::from)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}
