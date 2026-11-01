//! The engine handle (ADR 0011, "Live tuning"): the outputs of the last run, kept per stage, and generations that cancel a
//! superseded request.
//!
//! [`Engine::layout`] runs the stages from the first whose key (see `keys`) differs from the cache's, and replaces the
//! cache with the outputs of the run only when the run completes. A request carries a generation. Once a newer one has
//! started, an older request returns no result, and the cache it would have replaced stays as it was.

#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use super::keys::Stage;
use super::layout::{LayoutError, result_of};
use super::phases::{Stages, run_stages};
use crate::model::{Graph, Layout, Options, validate};

/// The generation of a request. Generations order the requests of one engine: a request is superseded once a request of a
/// newer generation has started.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Generation(u64);

impl Generation {
    /// The generation numbered `value`.
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    /// The number of this generation.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// A finished request: its generation, the layout, and the stages it ran again. The other stages came from the cache.
#[derive(Debug, Clone, PartialEq)]
pub struct Progress {
    generation: Generation,
    reran: Vec<Stage>,
    layout: Layout,
}

impl Progress {
    /// The generation this result answers.
    #[must_use]
    pub const fn generation(&self) -> Generation {
        self.generation
    }

    /// The stages this request ran, in the order they run. A stage that is not listed was read from the cache.
    #[must_use]
    pub fn reran(&self) -> &[Stage] {
        &self.reran
    }

    /// The layout.
    #[must_use]
    pub const fn layout(&self) -> &Layout {
        &self.layout
    }

    /// The layout, by value.
    #[must_use]
    pub fn into_layout(self) -> Layout {
        self.layout
    }
}

/// A layout engine that keeps the outputs of its last completed run, so that a change to the inputs re-runs only the
/// stages from the first one that reads it.
#[derive(Debug, Default)]
pub struct Engine {
    newest: AtomicU64,
    cache: Mutex<Option<Stages>>,
}

impl Engine {
    /// An engine with an empty cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Lays out `graph` with `options` as request `generation`, re-running from the first stage whose key differs from
    /// the cache's. The request first makes `generation` the newest, which supersedes every older request, even one that
    /// is refused as invalid.
    ///
    /// Returns `Ok(None)` when a newer generation has started before the request finishes: the request returns no result,
    /// and the cache is left as it was.
    ///
    /// # Errors
    ///
    /// Returns [`LayoutError::Input`] when `validate` refuses the graph or the options, and [`LayoutError::Phases`] when
    /// the phases do not run on a valid graph.
    pub fn layout(
        &self,
        graph: &Graph,
        options: &Options,
        generation: Generation,
    ) -> Result<Option<Progress>, LayoutError> {
        self.newest.fetch_max(generation.get(), Ordering::SeqCst);
        validate(graph, options).map_err(LayoutError::Input)?;
        self.advance(graph, options, generation, &|| self.is_newest(generation))
    }

    /// Whether no request of a newer generation has started.
    fn is_newest(&self, generation: Generation) -> bool {
        self.newest.load(Ordering::SeqCst) <= generation.get()
    }

    /// Runs the stages that `current` allows, from the cache, and replaces the cache when the run completes. `current` is
    /// asked before each stage that runs and once more before the result is kept, so a superseded request returns `None`.
    fn advance(
        &self,
        graph: &Graph,
        options: &Options,
        generation: Generation,
        current: &dyn Fn() -> bool,
    ) -> Result<Option<Progress>, LayoutError> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(run) =
            run_stages(graph, options, cache.as_ref(), current).map_err(LayoutError::Phases)?
        else {
            return Ok(None);
        };
        if !current() {
            return Ok(None);
        }
        let layout = result_of(graph, options, &run.stages.view());
        *cache = Some(run.stages);
        Ok(Some(Progress {
            generation,
            reran: run.reran,
            layout,
        }))
    }
}
