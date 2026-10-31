//! Public entry: the engine handle, its progress and generations (stub until the engine lands). `layered` builds the
//! layered graph that ordering reads from the output of layering.

#[cfg(test)]
mod layered;

use crate::model::{EdgeLayouts, FrameError, Layout, decode_graph, encode_layout};

/// The hello stub's `layout`: decodes a graph frame and returns the frame of an empty layout. Phase 1 wires the
/// bindings to this function only; the engine replaces its body in Phase 2 and the bindings do not change.
///
/// # Errors
///
/// Returns the frame error when `graph` is not a graph frame of this version.
pub fn layout_frame(graph: &[u8]) -> Result<Vec<u8>, FrameError> {
    decode_graph(graph)?;
    // `point_start` has one entry more than there are edges, so the empty layout still starts at zero.
    let layout = Layout {
        edges: EdgeLayouts {
            point_start: vec![0],
            ..EdgeLayouts::default()
        },
        ..Layout::default()
    };
    Ok(encode_layout(&layout))
}

#[cfg(test)]
mod tests {
    use super::layout_frame;
    use crate::testkit::frame_fixture;

    #[test]
    fn the_hello_layout_is_the_typescript_empty_layout_for_the_golden_graph() {
        let out = layout_frame(&frame_fixture("graph")).expect("the golden graph is a frame");
        assert_eq!(out, frame_fixture("empty-layout"));
    }

    #[test]
    fn the_hello_layout_refuses_bytes_that_are_not_a_graph_frame() {
        assert!(layout_frame(b"not a frame").is_err());
        assert!(layout_frame(&frame_fixture("layout")).is_err());
    }
}
