//! Public entry: the engine handle, its progress and generations, and the wrapper `layout`. `handle` keeps each stage's output
//! and re-runs from the first stage whose key (`keys`) changed. `layered` builds the layered graph that ordering reads from
//! the output of layering, and `phases` runs the stages on a model graph. `layout_frame` and `layout_frame_on` are the
//! frame entries the bindings call (ADR 0011, Decision 6): graph frame in, layout frame out.

mod handle;
mod keys;
pub(crate) mod layered;
mod layout;
mod phases;

use std::fmt;

pub use crate::route::{ClusterBox, EdgeRoute, Point, Rect, RouteWork, Routing};
pub use handle::{Engine, Generation, Progress};
pub use keys::Stage;
pub use layout::{LayoutError, layout};
pub use phases::{PhaseError, Phases, run_phases};

use crate::model::{FrameError, Options, decode_graph, encode_layout};

/// Why a frame entry refused a call: the graph bytes are not a graph frame of this version, or `layout` refused the graph
/// or the options.
#[derive(Debug, Clone, PartialEq)]
pub enum FrameLayoutError {
    /// The graph bytes are not a graph frame of this version.
    Frame(FrameError),
    /// `layout` refused the graph or the options.
    Layout(LayoutError),
}

impl FrameLayoutError {
    /// The kind of the refusal, for a binding to report as its error code: `frame`, `input` or `phases`.
    #[must_use]
    pub const fn kind(&self) -> &'static str {
        match self {
            Self::Frame(_) => "frame",
            Self::Layout(LayoutError::Input(_)) => "input",
            Self::Layout(LayoutError::Phases(_)) => "phases",
        }
    }
}

impl fmt::Display for FrameLayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Frame(error) => write!(f, "{error}"),
            Self::Layout(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for FrameLayoutError {}

/// Lays out the graph frame `graph` with `options` and returns the layout frame. A one-shot run: it builds a fresh
/// engine, so nothing is kept between calls.
///
/// # Errors
///
/// Returns [`FrameLayoutError::Frame`] when `graph` is not a graph frame of this version, and
/// [`FrameLayoutError::Layout`] when `layout` refuses the graph or the options.
pub fn layout_frame(graph: &[u8], options: &Options) -> Result<Vec<u8>, FrameLayoutError> {
    let graph = decode_graph(graph).map_err(FrameLayoutError::Frame)?;
    let layout = layout(&graph, options).map_err(FrameLayoutError::Layout)?;
    Ok(encode_layout(&layout))
}

/// Runs request `generation` of the graph frame `graph` on `engine` and returns the layout frame, as [`Engine::layout`]
/// does for the decoded graph. Returns `None` when a newer generation has started before the request finishes. A frame
/// that does not decode is refused before the engine sees it, so it starts no generation.
///
/// # Errors
///
/// Returns [`FrameLayoutError::Frame`] when `graph` is not a graph frame of this version, and
/// [`FrameLayoutError::Layout`] when `engine` refuses the graph or the options.
pub fn layout_frame_on(
    engine: &Engine,
    graph: &[u8],
    options: &Options,
    generation: Generation,
) -> Result<Option<Vec<u8>>, FrameLayoutError> {
    let graph = decode_graph(graph).map_err(FrameLayoutError::Frame)?;
    let progress = engine
        .layout(&graph, options, generation)
        .map_err(FrameLayoutError::Layout)?;
    Ok(progress.map(|progress| encode_layout(progress.layout())))
}

#[cfg(test)]
mod tests {
    use super::{Engine, FrameLayoutError, Generation, layout_frame, layout_frame_on};
    use crate::model::{EdgeKindPolicy, Options};
    use crate::testkit::frame_fixture;

    /// Options that give the golden graph's two edge kinds a policy, so that it lays out.
    fn golden_options() -> Options {
        let policy = |ranks| EdgeKindPolicy {
            ranks,
            ..EdgeKindPolicy::default()
        };
        Options {
            edge_kinds: [
                ("lineage".to_string(), policy(true)),
                ("ref".to_string(), policy(false)),
            ]
            .into_iter()
            .collect(),
            ..Options::default()
        }
    }

    #[test]
    fn the_one_shot_lays_out_the_golden_graph_as_a_layout_frame() {
        let out = layout_frame(&frame_fixture("graph"), &golden_options())
            .expect("the golden graph is a frame and lays out");
        assert_eq!(&out[..4], b"GLFR");
        assert_eq!(
            layout_frame(&frame_fixture("graph"), &golden_options()),
            Ok(out),
            "the same frame and options give the same bytes"
        );
    }

    #[test]
    fn the_one_shot_refuses_bytes_that_are_not_a_graph_frame_as_a_frame_error() {
        let error =
            layout_frame(b"not a frame", &golden_options()).expect_err("the bytes are not a frame");
        assert_eq!(error.kind(), "frame");
        assert!(matches!(error, FrameLayoutError::Frame(_)));
        assert!(layout_frame(&frame_fixture("layout"), &golden_options()).is_err());
    }

    #[test]
    fn the_one_shot_refuses_an_unknown_effort_as_a_phase_error() {
        let options = Options {
            effort: Some("instant".to_string()),
            ..golden_options()
        };
        let error = layout_frame(&frame_fixture("graph"), &options).expect_err("unknown effort");
        assert_eq!(error.kind(), "phases");
        assert!(error.to_string().contains("instant"), "{error}");
    }

    #[test]
    fn the_handle_returns_the_one_shot_bytes_for_the_same_request() {
        let graph = frame_fixture("graph");
        let options = golden_options();
        let engine = Engine::new();
        let handled = layout_frame_on(&engine, &graph, &options, Generation::new(1))
            .expect("the golden graph lays out on the handle");
        assert_eq!(
            handled,
            Some(layout_frame(&graph, &options).expect("one-shot"))
        );
    }

    #[test]
    fn the_handle_refuses_a_frame_that_does_not_decode_and_starts_no_generation() {
        let engine = Engine::new();
        let error = layout_frame_on(&engine, b"x", &golden_options(), Generation::new(5))
            .expect_err("the bytes are not a frame");
        assert_eq!(error.kind(), "frame");
        // Generation 5 never started, so generation 3 still runs.
        let kept = layout_frame_on(
            &engine,
            &frame_fixture("graph"),
            &golden_options(),
            Generation::new(3),
        );
        assert!(matches!(kept, Ok(Some(_))), "{kept:?}");
    }

    #[test]
    fn the_handle_refuses_invalid_options_as_an_input_error() {
        let graph = frame_fixture("graph");
        let mut options = golden_options();
        options
            .edge_kinds
            .get_mut("lineage")
            .expect("the kind")
            .source_side = Some("diagonal".to_string());
        let engine = Engine::new();
        let error = layout_frame_on(&engine, &graph, &options, Generation::new(1))
            .expect_err("the source side is not a side");
        assert_eq!(error.kind(), "input");
    }
}
