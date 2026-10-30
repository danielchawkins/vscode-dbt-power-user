# Lineage layout: open decisions

**Answered 2026-10-29.** The answers are recorded in [ADR 0011](../adr/0011-graph-layout-in-rust.md), "Owner decisions", and in the [roadmap](lineage-layout-roadmap.md).

Answer each question by replacing `Answer:` with your choice; one word or a short sentence is enough. `Recommended` is the option the plans propose, with its reason. Leave a question blank to accept the recommendation.

The roadmap is [lineage-layout-roadmap.md](lineage-layout-roadmap.md); the Rust ADR is [0011](../adr/0011-graph-layout-in-rust.md).

## Rust engine (from ADR 0011)

### Q1 (O-1). Where does the extension run the engine?

- **A. Extension host:** WASM in a `worker_threads` Worker, the native addon when present. No webview security-policy change. *Recommended:* one universal artifact, the host keeps caches across panel reloads.
- **B. A Worker inside the webview:** needs `'wasm-unsafe-eval'` and `worker-src` in the panel's CSP, adopted only if spike S8 passes on VS Code and Cursor.

Answer: A

### Q2 (O-2). Ship a native Node addon?

- **A. No native addon in the first release;** platform-specific VSIXes only if spike S6 shows at least about 1.5x over WASM. *Recommended:* avoids a per-platform release matrix until it pays.
- **B. Ship native from the start,** one VSIX per platform.

Answer: A

### Q3 (O-3). Where does the Rust library live?

- **A. `crates/` in this repository until the switch to Rust;** then choose crates.io and npm names and publishing. *Recommended:* one repo, one gate, while the API settles.
- **B. Its own repository now,** published and consumed as a dependency.

Answer: A

### Q4 (O-4). What happens to the TypeScript engine after the switch?

- **A. Keep it as a dev-only reference that never ships,** used by the parity tests, until you retire it. *Recommended.*
- **B. Delete it at the switch;** keep only the golden fixtures.

Answer: A

### Q5 (O-5). Add the new features to the TypeScript engine too?

- **A. No:** attraction, exclusion, wrapping and the rest exist only in Rust; TypeScript stays frozen at parity. *Recommended.*
- **B. Yes:** implement each in TypeScript first, then port.

Answer: A

### Q6 (O-6). How exact must the Rust port match TypeScript?

- **A. Bit-for-bit for every phase;** any deliberate algorithm change is made in TypeScript first and re-baselined. *Recommended:* the parity gate stays mechanical.
- **B. Bit-for-bit except placement,** which may differ within a documented tolerance.

Answer: Neither. I don't need bit for bit, --- discrepancies should be noted, but if
rearchitecting makes it better designed/more robust/resilient, that's better. Equality of
otucomes, not slavish adherence.

### Q7 (O-7). Do attraction edges join components?

- **A. Yes,** so packing never separates two nodes an attraction is meant to keep close. *Recommended.*
- **B. No:** components follow ranking and routed edges only.

Answer: A, but should be part of the general ability to turn off certain edges or groups of edges
and reflow.

### Q8 (O-8). Wrapped rows for very wide ranks: a separate stage or a placement mode?

- **A. Decide after spike S9** measures crossings, bends and bounds; the draft design is a stage after ordering. *Recommended.*
- **B. A stage after ordering,** decided now.
- **C. A placement mode,** decided now.

Answer: A, but mostly placement mode? Just need lots of flexibility in layouts.

### Q9 (O-9). Make the panel's layout call asynchronous?

- **A. Yes:** `LayoutEngine.layout` returns a Promise with a generation number, so a superseded layout is cancelled and the panel never freezes. *Recommended;* needed for any off-thread engine.
- **B. No:** keep it synchronous.

Answer: A

### Q10 (O-10). VSIX size budget

The current `vsix` ceiling is 800,000 bytes; an older plan says 5.5 MB.

- **A. Measure the WASM first (spike S11);** raise the ceiling only if it does not fit. *Recommended.*
- **B. Raise it now to:** (give a number)

Answer: A, don't be too strict about ceiling. Say less than 2 MB --- obviously smaller is better if
possible, but I'd rather have somewhat bigger and more features/performance.

### Q11 (O-11). Accept single-threaded WASM in the browser?

- **A. Yes,** if spike S3 shows webviews are not cross-origin isolated (expected); threads only on the native path. *Recommended.*
- **B. No:** find a way to get threads in the browser first.

Answer: A, but do try to find a way to get threads in browser. Look up other resources and mechanisms.

### Q12 (O-12). Rust toolchain pin

- **A. Pin 1.97.1 (as elk-rs does),** update deliberately with each release. *Recommended.*
- **B. Track stable,** update automatically.

Answer: B, track stable, start with the latest stable for everything right now. Later, can pin.

### Q12b (D-attr). Do attraction edges affect card order within a rank?

- **A. Yes, as a low-weight tie-break,** so a collapsed busy node's neighbours stay in order near it; compare crossings with and without (spike S9). *Recommended.*
- **B. No:** attraction only affects placement and routing; ordering stays as today.

Answer: A

## Panel behaviour (from the panel scout and the controls research)

You asked for these to be panel controls. Each question is the default the control starts with.

### Q13. Hiding a card: what about cards drawn only through it?

- **A. They disappear too,** like collapsing an expansion today. *Recommended:* nothing is drawn floating with no visible path to the focus.
- **B. They stay,** unconnected to the focus.

Answer: A

### Q14. Excluding a node such as `normalize_timestamp`: link its parents straight to its children?

- **A. Yes:** draw `A → B` in place of `A → normalize_timestamp → B`, with a marker that a node was skipped. *Recommended:* the lineage stays true.
- **B. No:** just drop its edges.

Answer: B

### Q15. Hidden cards are remembered…

- **A. Per workspace, for every start model.** *Recommended:* hiding a utility hub once should stick.
- **B. Per start model.**

Answer: A

### Q16. The busy-node threshold

- **A. Its own setting** (the panel lists nodes above it; default 15 connections). *Recommended.*
- **B. Tied to `lineage.maxNeighbours`** (default 20).

Answer: B

### Q17. What should automatic exclusion cover by default?

- **A. Nothing:** exclusion is opt-in, from the busy-node list or rules you add. *Recommended.*
- **B. Functions (`resource_type: function`) excluded by default.**
- **C. Other:** (say which)

Answer: B functions, and macros, but also accept any dbt selector (run via dbt to get nodes). The default
of functions/macros should be implemented via that dbt selector mechanism.

### Q18. Nested cluster boxes inside layer bands, by…

- **A. Folder** (matches today's grouping). *Recommended* as the default key.
- **B. Schema.**
- **C. Package.**
- **D. A tag or meta key you name.**
- **E. None by default;** a control to turn it on.

Answer: A by default, but configurable

### Q19. The default view

- **A. Neighbourhood around the open model** (depth 2/2, card budget about 150), with the whole-project view as a mode. *Recommended:* the research found focus-plus-context beats whole-graph overviews for targeted questions, and the full graph is 55:1 wide.
- **B. Whole project by default,** centred on the open model (what you asked for earlier).

Answer: B, cenetered *and zoomed* on the open model, so everything is readable.
