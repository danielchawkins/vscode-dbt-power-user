# Remaining implementation

This is the executor plan for work still ahead of `main`. Contracts, file lists, spikes, and Confirm gates stay in [`fusion-lsp-plan.md`](fusion-lsp-plan.md). Landing rules stay in [`implementation-dispatch.md`](implementation-dispatch.md). Do not invent vocabulary; use `CONTEXT.md`.

## Current position

**Completed at this tip:** Phases 0–4, the Fusion client through 5.4, publication epochs, the manifest metadata-source port, Phase 7.1 adapter retirement, and Phase 8.2 Python bridge removal. Project Registry is the sole scope authority and DBTProjectContainer routes one metadata source per Declared Project through the existing consumer event. Core, Cloud, and Core-command construction is removed. `FusionProjectIntegration` composes the published Fusion integration directly with source-path and `dbt_project.yml` watchers only; run history reads `run_results.json` after queued commands only when post-command content differs from the pre-command snapshot. Direct Fusion CLI execution uses the same `ConfiguredFusionExecutableResolver` path and env snapshot as the LSP client through a per-project process boundary; folder-scoped executable-path changes re-resolve and replace the CLI delegate while keeping LSP and CLI synchronized; the Python bridge payload, sqlfmt document formatter, and Python extension dependency are gone. The extension packages as `0.2.0-alpha.0` against the 1.128 Extensions API with webview compiled for Chromium 148.

**Completed evidence:** pinned VS Code 1.128.0 and unauthenticated Cursor 3.21.16 each record all three host activation phases, real-webview FCP, and host resolve-to-ready across ten fresh processes. Webview target is now `chrome148` with `rolldownOptions`, and the Tailwind guard retains 543 base selector tokens. Project Registry coverage includes registration, fail-closed semantics, explicitly declared package roots, canonical deduplication and aliases, lookup order, containment, parent-versus-individual workspace equivalence, watchers, configuration and workspace-folder changes, stable events, and disposal. Phase 4.5 verifies that a file outside every Declared Project never inherits a prior pick.

**Next:** Phase 8.3 removes Altimate and hosted remnants.

What is still true of the product: it is manifest-driven. Extension-host Altimate API/network egress and `AltimateRequest` are removed; local column lineage is unavailable when the native SQL engine fails, is unavailable, or is cancelled (panel status false, no error popup on cancellation). `DBTProjectIntegrationAdapter` is retired from production code; manifest parsing and source-path watching live in `FusionProjectIntegration`. `AltimateHttpClient` is never constructed. Local model-depth computation and ref-depth decorations remain enabled with fixed default thresholds and colors; there is no opt-out setting. `ModelDepthParser` receives a local context exposing only `throwIfNotAuthenticated`; four fixed local-return methods remain on `DBTConfiguration` solely because the external interface requires them.

A React 19 attempt was abandoned for vendoring generated output into `src/`, and React is **not** scheduled as a selected target: D6 decides the runtime at v2.2. Vendoring generated output is prohibited outright — generated CSS or JavaScript may arrive through a package's `exports`, never as a committed copy.

## How to land a step

Product context: the shipped extension never invokes `mise` or `just`, never reads `mise.toml`, and never assumes a Consumer Repository layout.

```bash
just jj workspace add ../fusion-pu-<step> --revision <parent-bookmark> -m "<one-line subject>"
cd ../fusion-pu-<step>
just sync
# implement one plan step, TDD at the named seam
# finish each concern or file group as a focused revision
just jj commit -m "<focused revision>"
# repeat until the PR bookmark is complete
just check
just package   # only when the PR changes packaging or contributions
```

Implementation is serial: only one PR is being coded at a time, and its revisions are built in order. Split docs, configuration, and distinct modules or concerns into focused revisions; keep each concern's tests with its implementation. The complete bookmark tip, not every intermediate revision, is the required green unit.

External review and CI do not create idle time. Once PR N is locally green, passes the local read-only review, and is pushed, begin PR N+1 locally as a child of N's bookmark tip in another jj workspace. If N is rewritten, jj rebases descendants. If a fix is added on top of N, run `just jj rebase --source <n+1-root> --destination <parent-bookmark>`. After N merges, rebase the full N+1 revision range onto `main`, rerun its gates, then push its bookmark. Never push a dependent PR before its parent merges.

Do not `git commit`, `git checkout -b`, or `git push`. The parent session owns revision shaping, rebases, bookmarks, pushes, PR review fixes, CI repairs, and merges. Reviewers read the full bookmark diff and its revision boundaries against the spec contract.

For each PR, use the dispatch document's loop: fast coding agent for implementation, separate higher-reasoning agent for detailed read-only review, orchestrator evidence check, then resume the same coding agent for accepted fixes. Every agent inspects revisions with `just jj`; only implementers create revisions, and only the orchestrator publishes them.

## Gotchas that already bit us

- `DBTFusionCommandDetection` is not in `src/dbt_client/dbtFusionCommandIntegration.ts`. Wrap it in this extension.
- Collaborators are constructed before `activate()`. An early return cannot un-construct them; it can only skip later work.
- There is no `src/manifest/` and no `src/domain.ts`. Project Registry and Project Context own scoping; DBTProjectContainer produces DBTProject instances. The metadata event is `src/dbt_client/event/manifestCacheChangedEvent.ts`, and the map types and parsers come from `@altimateai/dbt-integration`.
- `just test-integration` already exists and already runs `@vscode/test-electron` over `src/test/integration/**/*.test.ts` (LSP transport, run-history, target-write captures). Step 2.2 extends that harness; it does not replace it or pull it into `just check`.
- Fusion 2.x `--version` is `dbt 2.0.5`, not `dbt-fusion`. Configured-path resolution is step 5.1, not 1.2.
- Decision 9: silent startup except the 1.3 conflict error. Do not add toasts in later steps; status bar, output channel, or Problems.
- Untested-major `notFound` was dropped from the 1.2 type because PATH miss is already `notFusion`. Step 5.1 reintroduces a blocking missing-path verdict on the configured path.

## Dependency follow-ons before Phase 4

Serial PRs, each carrying the constraints below. Do not start Phase 4 until every booked follow-on is on `main`.

**Ceiling:** `engines.vscode` and `@types/vscode` are the newest Extensions API both VS Code and Cursor support. The compatibility Confirm is discharged by merged step 3.7: installed Cursor reports `vscodeVersion` 1.128.0 and VS Code is 1.137.0, so `engines.vscode` uses their 1.128 intersection. `@types/vscode` has no 1.128 release; pin 1.125.0 exactly so types do not float above the host API. The webview has a second, separate ceiling — Chromium 148, derived from VS Code 1.128.0's Electron 42.5.0 — and it is set in step 3.15, after step 3.14's smoke job proves both hosts.

**Job:** every remaining direct npm dependency (root and `webview_panels`) takes the newest published major as `^x.y.z`, except the API types pin above. Replace a package that is unmaintained or cannot take the current major. No `"ignoreDeprecations"`. Refresh lockfiles, re-review `allowScripts`, and keep `just check` and `just package` green.

**Engines:** `engines.node` is `>=<current LTS major> <next major>`. mise contributor CLIs already track `latest`; Fusion stays `2.0.5` in `mise.toml` — product minimum, not a library to float. SHA-pin GitHub Actions stay SHA-pinned.

**Do not:** add complexity lint in these PRs; delete the Core or Cloud factories, which the external adapter's constructor still requires; bump Fusion; treat CommonJS as inviolable; vendor generated output; settle **D6**, **D7**, or **D8** by writing a framework, a renderer, or a Tailwind decision into one of these PRs.

**Booked, in order.** Each row is one bookmark and one PR, independently green at its tip. Contracts, file lists, and verification for 3.8 through 3.15 are in the plan.

| #  | PR                                                    | Contents                                                                                                                                                                                                 | Depends on |
| -- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1  | Tailwind guard, blocker                               | Merged. The regression guard plus evidence that the `al-` generation cannot move to v4 while its consumer ships v3 class strings. Records **D8**; does not resolve it.                                   | —          |
| 2  | Webview ESLint 10                                     | Merged. Native ESLint 10 config, supported plugins, stable correctness/a11y rules, and an exact warning ratchet.                                                                                         | 1          |
| 3  | 3.8 code block and `noop`                             | Merged. Local CodeBlock capability preserving its prop interface; local `noop` replaces the documentation editor's internal Ant import.                                                                  | 2          |
| 4  | 3.9 hosted webview cut                                | Merged. Hosted routes/providers and `webview_panels/src/lib/` are gone; retained validate/install commands resolve projects through the picker.                                                          | 3          |
| 5  | 3.10 dependency pruning                               | Merged. Zero-reference and vendored-bundle dependencies are removed; remaining advisories belong to lineage and Perspective.                                                                             | 4          |
| 6  | 3.11 image audit                                      | Merged. Reference-audited asset deletion with an exact runtime/contribution icon guard.                                                                                                                  | 4          |
| 7  | 3.12 Codicons allowlist                               | Merged. Copy only `codicon.css` and `codicon.ttf` from the plugin.                                                                                                                                       | —          |
| 8  | 3.13 tests and baselines                              | Merged. Vitest/Testing Library tests against current seams plus reproducible single-entry payload and build/package baselines.                                                                           | 3          |
| 9  | 3.14 host smoke + timing                              | Complete at this tip. Both pinned hosts have acquisition, packaged-VSIX smoke, metadata, and ten fresh-process activation/FCP/ready samples.                                                             | 8          |
| 10 | [3.15 browser target](step-3-15-vite-optimization.md) | Complete at this tip. Set `chrome148`, migrated to `rolldownOptions`, retained esbuild after the default minifier rejected invalid dependency-derived utilities, and preserved 543 base selector tokens. | 9          |

Deliberately not in this list: the shared message contract, which arrives at v2.1 as `packages/webview-contract/` together with the npm workspace that makes it resolvable, and must not be stubbed in v1 so a test can be written against it; React 19, which **D6** has not selected and which must not be adopted merely to unblock a dependency bump; `@finos/perspective*` to `@perspective-dev/*`, which is v2.5 behind its spike; and TypeScript 7 until `typescript-eslint` supports it.

After the last of these, evaluate a report-only `just lint-complexity` (ESLint `complexity` / `max-depth` or sonarjs). Prefer warn or a non-failing recipe. Do not add it to `just lint`, `just check`, Lefthook pre-push, or CI. Promoting it to a gate needs a later Confirm, and not before Phase 8 at the earliest.

## Phase 4 — Declared Projects

Start only after every dependency follow-on above is on `main`. Implement 4.1 through 4.5 serially.

| Step | Bookmark                            | Turns green                                                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1  | `feat/declared-project-roots`       | Complete at this tip. Resource-scoped `dbt.projects` plus the fail-closed resolver and cases 3, 5, and 6 at the configuration seam.                                                                                                                                                                                                  |
| 4.2  | `feat/project-registry`             | Complete at this tip. Adds the inert registry seam with two projects on `multi-root`, explicit package-root promotion, and no recursive registry watchers; activation wiring waits for 4.3/4.4.                                                                                                                                      |
| 4.3  | `feat/project-context`              | Complete at this tip. Project Context initializes the registry, keeps DBTProject production on the old path, and rewires Query Manifest project/event resolution without changing consumer signatures.                                                                                                                               |
| 4.4  | `feat/retire-discovery`             | Complete at this tip. Project Registry drives the sole DBTProject producer; recursive discovery, obsolete workspace-folder tests, `dbt.allowListFolders`, and Query Manifest's temporary zero-registry fallback are gone. Registry reconciliation is ordered and serialized, with unchanged container behavior retained under tests. |
| 4.5  | `feat/retire-project-pin-fallbacks` | Complete at this tip. Silent `dbtPowerUser.projectSelected` resolution is retired in hover, autocomplete, code lenses, and path-free SQL execution. Project Context inference and explicit user-invoked picks are the only resolution paths. Explicit project-pick and validate/install behavior preserved. Release `0.2.0-alpha.0`. |

## Phase 5 — spikes, then LSP

Do not start 5.x until Phase 4 is on `main`. Each spike is its own bookmark and PR of evidence only, run before the step in its "Before" column; the table lists all ten here so none is discovered late, not because all ten precede Phase 5.

Spike privacy rules are in the plan and are conditions of running: synthetic fixtures for verbose traces, redaction at capture, no SQL or result retention, transient query ids, explicit opt-in for anything touching an account.

| Spike | Before            | Output                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6    | 5.2               | `docs/refactor/s6-cursor-parity.md`. Discharged: Cursor 3.20.14 / API 1.128.0 loads `vscode-languageclient` 10.1.1 through the official runner, accepts `engines.vscode: ^1.128.0`, and installs a local VSIX through the isolated CLI. Pin major 10.                                                                                                                                                                                                                 |
| S2    | 5.3, 6.2, Phase 7 | `docs/refactor/lsp-commands.md`. Partial: every tried `compileFile` shape returned an error; `show.columns` was `null` on dummy credentials, so column types are unknown; `listNodes` returned `null`; `previewCte` and `goToDefinition` match an unknown command. Does not discharge 6.2 or the 7.4 column-type question.                                                                                                                                            |
| S3    | 5.3               | `docs/refactor/s3-document-selector.md`. Partial library evidence: major 10 is required; failed conversion fails open, so step 5.3 must use string URI bases and reject patternless filters. Live two-client, no-folder, overlapping-root, and `target/` cases remain open.                                                                                                                                                                                           |
| S4    | 5.3               | `docs/refactor/s4-process-lifecycle.md`. Partial (pre-load handshake): fixture-only ~53 MiB and 89 ms to the `initialize` response for one process, ~106 MiB summed pre-load RSS and 120 ms max for two; idle socket close exits (n=3); idle `SIGTERM` in 3 ms (n=1). Post-load memory/startup, Consumer Repository scale, window reload, in-flight disposal, and empirical `SIGTERM`-to-`SIGKILL` ceiling not measured — step 5.3's open lifecycle questions remain. |
| S5    | 5.3               | `docs/refactor/s5-coexistence.md`. Partial static comparison with `dbtLabsInc.dbt`: distinct advertised LSP command ids are required; duplicate diagnostics, TextMate behavior, and the prefix-vs-guard decision remain open.                                                                                                                                                                                                                                         |
| S1    | 5.5               | `docs/adr/0005-dependency-diagnostics.md`. Research complete: no dependency diagnostics or harmful noise were observed, so 5.5 passes Fusion diagnostics through unchanged and adds filtering only with a concrete production regression.                                                                                                                                                                                                                             |
| S10   | 5.6, 7.4          | `docs/refactor/s10-static-analysis.md`. Research complete for sequencing: launch `baseline`, keep effective mode `unknown`, and verify each provider replacement in its implementation PR. Strict-dependent features remain deferred until positive runtime evidence.                                                                                                                                                                                                 |
| S8    | 6.2               | `docs/refactor/s8-config-changes.md`. Inconclusive: the server registered `**/*`, and neutral project/profile edits plus an in-place lock rewrite were applied, but the project never loaded and no producer evidence appeared. The LSP source initially refreshes on observed compile completion and restart; broaden only with a failing implementation test.                                                                                                       |
| S7    | 7.1               | `docs/refactor/s7-target-writes.md`. Inconclusive: the project never loaded, no edit/save occurred, and snapshots were before/after only. No target write was observed, so the watcher-rate arm was not triggered. Step 7.1 retired the ambient target watcher regardless.                                                                                                                                                                                            |
| S9    | 7.4               | `docs/refactor/s9-query-phases.md`. Partial: exact-repeat timings measured; cold provisioning unproven; reuse-disabled unavailable across Fusion sessions. CLI preview exposed no query id, cancellation, or tag mechanism; LSP cancellation/tag remain unchecked. Step 7.4 stays open.                                                                                                                                                                               |

Then serial 5.0 → 5.4. **5.0 follows D5**: `src/fusion/staticAnalysisMode.ts` carries the resource-scoped configured mode, supplies the launch argument, and keeps effective mode unknown without positive server evidence. There is no login or fallback branch. 5.1 is the configured-path resolver, 5.2 is reverse-socket transport, 5.3 is client and pool with mandatory command prefix and isolated target output, and 5.4 is status/output with the permanent zero-notification test. 5.5 adopts diagnostic pass-through. In 5.6, each provider deletion lands with its production-shaped replacement test. The `0.3.0-alpha.0` release follows those implementation tests.

## Phases 6–10 — serial with Confirm gates

6.0 stamps the publication epoch and producer identity onto `ManifestCacheProjectAddedEvent` without changing consumers. 6.1 introduces the producer port. Fusion's LSP payload cannot populate the complete metadata contract, so the manifest source remains selected. **7.1 retired `DBTProjectIntegrationAdapter`** by replacing its parser/watcher composition with local `FusionProjectIntegration` without duplicating parser logic. Core and Cloud construction is already removed.

| Gate           | Stop until                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Before 5.0     | **D5** is decided: no login. Configured mode supplies the launch argument; effective mode remains unknown without positive evidence |
| Before Phase 7 | S2 inventory; name any retained feature with no command and no artifact                                                             |
| Before 7.4     | S9 and S10 evidence for the warehouse- and `strict`-dependent features                                                              |
| Before 8.2     | 7.1 merged; beta.2 soaked on `finance-pipelines`                                                                                    |
| Before 10.4    | all seven consumer characterization cases green through the fork                                                                    |
| Before v2.3    | **D6** and **D7** from v2.2's joint benchmark, plus the Perspective spike verdict                                                   |

Hard-to-reverse, each v1 one preceded by a release: 7.1 (retire the adapter), 8.2 onward, 9.1 (namespace rename), and v2.3 (the lineage renderer). Step 8.1 is exempt because it deletes already-unreachable construction. Do not batch the remaining boundaries.

6.1 must not change consumer files. If it must, stop: the metadata event is the wrong boundary.

Phase 10 is work in `/Users/daniel/projects/finance-pipelines` with that repo's `gh stack` skill, not this repo's feature-PR loop.

## v2 — the north-star horizon

Section 4 of the plan. **It starts after v1 is complete through Phase 10 and the 1.0.0 release**, with step 3.13's baseline recorded and step 3.14's smoke job green; the namespace, the distribution pipeline, and consumer adoption settle before any panel is rebuilt under them. Order: v2.1 the `packages/webview-contract/` message contract and the npm workspace that carries it, `LineageData`, per-panel entries, and `PanelHost`, with the panels unchanged; v2.2 the joint runtime and renderer benchmark against that baseline, resolving D6 and D7; v2.3 the selected renderer; v2.4 the styling contract per D8; v2.5 Perspective; v2.6 the runtime application with the token layer and UI-only panel persistence; v2.7 the React candidates only if the selected stack and its tests justify them; v2.8 the Playwright harness.

## Reviewer checklist (every PR)

- Matches the named step's contract and verification, including path corrections in the dispatch doc.
- Revisions separate docs, configuration, and distinct modules or concerns. Bookmark is not `main` or `fusion-lsp-client`.
- No mise/just in `src/`, `webview_panels/`, or `package.json` contributions.
- No issue or PR numbers in code. Lines under 120 characters. Markdown prose is one physical line per paragraph.
- Ponytail: no files the plan says to delete later; no telemetry shim; no 5.1 resolver inside 2.x tests beyond PATH checks.
- No generated output committed to `src/` or `webview_panels/src/`, and no patched `node_modules`.
- No new ambient watching of `target/`, no writes into any project's `target/`, no persisted compiler, schema, or result cache, and no second diagnostic store.
- No deferred decision settled in passing: D6 runtime, D7 renderer, D8 Tailwind. D5 is decided: no login.
- No performance target that the harness did not produce.
- `just check` green. `just package` when packaging changed.
