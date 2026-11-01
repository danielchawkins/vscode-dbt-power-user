//! Node-API binding (ADR 0011, Decision 6). `layout` takes a graph frame and JSON-shaped options and returns the layout
//! frame; `LayoutEngine` wraps the engine handle, and its `layout` takes a generation too. A refusal throws a JS `Error`
//! whose `code` is `frame`, `options`, `generation`, `input` or `phases`, and whose message is the refusal's message.
use graph_layout::engine::{Engine, FrameLayoutError, Generation, layout_frame, layout_frame_on};
use graph_layout::model::Options;
use napi::Env;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// A refusal of a call, with the code the JS caller reads.
#[derive(Debug)]
struct Refusal {
    code: &'static str,
    message: String,
}

impl From<FrameLayoutError> for Refusal {
    fn from(error: FrameLayoutError) -> Self {
        Self {
            code: error.kind(),
            message: error.to_string(),
        }
    }
}

/// The options as the UTF-8 JSON the caller sent.
fn options_of(json: &[u8]) -> Result<Options, Refusal> {
    serde_json::from_slice(json).map_err(|error| Refusal {
        code: "options",
        message: error.to_string(),
    })
}

/// The generation as the caller's number, which must be a non-negative whole number.
fn generation_of(generation: i64) -> Result<Generation, Refusal> {
    u64::try_from(generation)
        .map(Generation::new)
        .map_err(|_| Refusal {
            code: "generation",
            message: "the generation is not a non-negative whole number".to_string(),
        })
}

fn one_shot(frame: &[u8], options: &[u8]) -> Result<Vec<u8>, Refusal> {
    Ok(layout_frame(frame, &options_of(options)?)?)
}

fn on_engine(
    engine: &Engine,
    frame: &[u8],
    options: &[u8],
    generation: i64,
) -> Result<Option<Vec<u8>>, Refusal> {
    Ok(layout_frame_on(
        engine,
        frame,
        &options_of(options)?,
        generation_of(generation)?,
    )?)
}

/// Throws the refusal as a JS `Error` with its `code`, and returns `undefined`: the thrown error is what the caller sees.
fn finish(env: Env, result: Result<Option<Vec<u8>>, Refusal>) -> napi::Result<Option<Buffer>> {
    match result {
        Ok(frame) => Ok(frame.map(Buffer::from)),
        Err(refusal) => {
            env.throw_error(&refusal.message, Some(refusal.code))?;
            Ok(None)
        }
    }
}

/// Takes a graph frame (ADR 0011, Decision 6) and JSON options, and returns the layout frame.
///
/// # Errors
///
/// Throws when `frame` is not a graph frame of this version (`code` `frame`), when `options` is not valid options
/// (`options`), or when the graph or the options are refused (`input`, or `phases` when the phases do not run).
#[napi]
pub fn layout(env: Env, frame: &[u8], options: &[u8]) -> napi::Result<Option<Buffer>> {
    finish(env, one_shot(frame, options).map(Some))
}

/// The engine handle: the outputs of the last completed run are kept, so a relayout re-runs only the stages whose inputs
/// changed (ADR 0011, "Live tuning").
#[napi]
#[derive(Debug, Default)]
pub struct LayoutEngine {
    engine: Engine,
}

#[napi]
impl LayoutEngine {
    /// An engine with an empty cache.
    #[napi(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Runs request `generation` on the graph frame `frame` with the JSON options `options`, and returns the layout frame.
    /// Returns `undefined` when a newer generation has started before this request finishes.
    ///
    /// # Errors
    ///
    /// Throws as [`layout`] does. A frame that does not decode starts no generation.
    #[napi]
    pub fn layout(
        &self,
        env: Env,
        frame: &[u8],
        options: &[u8],
        generation: i64,
    ) -> napi::Result<Option<Buffer>> {
        finish(env, on_engine(&self.engine, frame, options, generation))
    }
}

#[cfg(test)]
mod tests {
    use super::{Refusal, generation_of, on_engine, one_shot};
    use graph_layout::engine::Engine;

    /// Options that give the golden graph's two edge kinds a policy, so that it lays out.
    const GOLDEN: &[u8] = br#"{"edgeKinds":{"lineage":{"ranks":true},"ref":{"ranks":false}}}"#;

    /// The golden graph frame: the `frame graph` line of the parity fixture, decoded from its hex.
    fn golden_graph() -> Vec<u8> {
        let text = include_str!("../../graph-layout/fixtures/parity/frame.txt");
        let hex = text
            .lines()
            .find_map(|line| line.strip_prefix("frame graph "))
            .expect("the fixture holds the golden graph");
        hex.as_bytes()
            .chunks(2)
            .map(|pair| {
                let digits = std::str::from_utf8(pair).expect("hex is ASCII");
                u8::from_str_radix(digits, 16).expect("hex digits")
            })
            .collect()
    }

    fn code_of(result: Result<impl std::fmt::Debug, Refusal>) -> &'static str {
        result.expect_err("the call is refused").code
    }

    #[test]
    fn the_one_shot_lays_out_the_golden_graph_with_default_options() {
        let first = one_shot(&golden_graph(), GOLDEN).expect("the golden graph lays out");
        assert_eq!(&first[..4], b"GLFR");
        assert_eq!(one_shot(&golden_graph(), GOLDEN).expect("again"), first);
    }

    #[test]
    fn partial_options_are_valid_options() {
        let all_default = one_shot(&golden_graph(), GOLDEN).expect("options with defaults");
        let explicit = one_shot(
            &golden_graph(),
            br#"{"edgeKinds":{"lineage":{"ranks":true},"ref":{"ranks":false}},"effort":"balanced","direction":"down"}"#,
        )
        .expect("the same options, written out");
        assert_eq!(all_default, explicit);
    }

    #[test]
    fn a_frame_that_is_not_a_graph_frame_is_refused_with_code_frame() {
        assert_eq!(code_of(one_shot(b"not a frame", GOLDEN)), "frame");
    }

    #[test]
    fn options_that_are_not_json_are_refused_with_code_options() {
        assert_eq!(code_of(one_shot(&golden_graph(), b"{")), "options");
        assert_eq!(
            code_of(one_shot(&golden_graph(), br#"{"direction":"sideways"}"#)),
            "options"
        );
    }

    #[test]
    fn options_the_graph_refuses_are_refused_with_code_input() {
        assert_eq!(
            code_of(one_shot(
                &golden_graph(),
                br#"{"edgeKinds":{"lineage":{"ranks":true,"sourceSide":"diagonal"},"ref":{"ranks":false}}}"#,
            )),
            "input"
        );
    }

    #[test]
    fn an_effort_the_phases_do_not_know_is_refused_with_code_phases() {
        assert_eq!(
            code_of(one_shot(
                &golden_graph(),
                br#"{"edgeKinds":{"lineage":{"ranks":true},"ref":{"ranks":false}},"effort":"instant"}"#,
            )),
            "phases"
        );
    }

    #[test]
    fn a_generation_must_be_a_non_negative_whole_number() {
        assert_eq!(generation_of(7).expect("7 is a generation").get(), 7);
        assert_eq!(code_of(generation_of(-1)), "generation");
    }

    #[test]
    fn the_engine_returns_the_one_shot_bytes_for_the_same_request() {
        let engine = Engine::new();
        let handled = on_engine(&engine, &golden_graph(), GOLDEN, 1).expect("the handle lays out");
        assert_eq!(
            handled,
            Some(one_shot(&golden_graph(), GOLDEN).expect("one-shot"))
        );
    }

    #[test]
    fn an_older_generation_returns_nothing_once_a_newer_one_has_started() {
        let engine = Engine::new();
        assert!(
            on_engine(&engine, &golden_graph(), GOLDEN, 2)
                .expect("gen 2")
                .is_some()
        );
        assert_eq!(
            on_engine(&engine, &golden_graph(), GOLDEN, 1).expect("gen 1"),
            None
        );
    }

    #[test]
    fn a_frame_that_does_not_decode_starts_no_generation() {
        let engine = Engine::new();
        assert_eq!(code_of(on_engine(&engine, b"x", GOLDEN, 5)), "frame");
        assert!(
            on_engine(&engine, &golden_graph(), GOLDEN, 3)
                .expect("gen 3")
                .is_some()
        );
    }
}
