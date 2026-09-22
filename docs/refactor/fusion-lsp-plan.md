# Fusion Power User: refactor plan

Land each step as a feature bookmark and a pull request against `main`. [`implementation-dispatch.md`](implementation-dispatch.md) is the execution layer: trunk, focused revisions, serial jj workspaces, pipelined landing, and file-path corrections. This file remains the spec: contracts, file lists, verification, spikes, and Confirm gates. Section 3 is v1, the incremental refactor through consumer adoption; Section 4 is the v2 north-star horizon that follows it. Remaining work is sequenced in [`remaining-implementation.md`](remaining-implementation.md).

## 1. Goal and scope

Turn this fork of `vscode-dbt-power-user` into **Fusion Power User** (`danielchawkins.fusion-power-user`): a local-only, MIT-licensed VS Code / Cursor extension for dbt Fusion projects, in which the native dbt Fusion language server owns all editor intelligence and no feature depends on a hosted service, an extension-specific account, telemetry, or a Python bridge.

In scope: product identity; the Declared Project model; a reverse-socket `LanguageClient` per Declared Project; replacing the manifest-driven parse loop and language providers with LSP-sourced metadata; rebasing compile / preview / run / build / test, query results, CTE preview and profiler, charting, model and column lineage, model trees, the local documentation editor, and local model generation and defer onto Fusion; removing dbt Core, dbt Cloud, Altimate hosted services, authentication, telemetry, AI, collaboration, MCP, and notebooks along with their dependencies; a new `fusionPowerUser.*` settings namespace; VSIX distribution via GitHub Releases; and adoption in the `finance-pipelines` consumer repository.

Explicitly out of scope: marketplace or OpenVSX publication; Windows and Linux support (macOS only for the first releases); a generic socket-to-stdio bridge; upstream compatibility or contributing changes back; any attempt to unlock a capability Fusion itself withholds, and any login flow — Fusion is the local engine, and the paid hosted product is dbt Cloud, which this extension does not support; and the MkDocs site under `documentation/`, which is deleted rather than rewritten.

Executors: work the steps in order, with one PR implementation active at a time. Each step is one PR bookmark whose ordered revisions separate documentation, configuration, and distinct modules or concerns; keep focused tests with their implementation. The bookmark tip compiles and has green tests. Review and CI for step N may overlap with local implementation of N+1 as a child of N's bookmark tip, but N+1 is not pushed until N merges; rebase the child range whenever its parent changes and onto `main` after the merge. Where a step says **Confirm**, stop and get a human decision before proceeding. The verification command throughout is `just check`, plus `just package` where a step changes packaging.

## 2. Grounding

### 2.1 Recorded decisions this plan honors

- `CONTEXT.md` — the vocabulary is fixed. Use **Declared Project**, **Dependency Project**, **Project Context**, **Local Capability**, **Hosted Capability**, **Consumer Repository**. Do not introduce "allowed folder", "discovered project", "child project", "selected project", "premium feature", or "downstream repository". Extend `CONTEXT.md` when a step introduces a genuinely new concept.
- `docs/adr/0001-local-fusion-only-product.md` — independent local Fusion-only product; remove dbt Core, dbt Cloud, hosted Altimate services, auth, telemetry, AI, collaboration, MCP, notebooks.
- `docs/adr/0002-use-the-native-fusion-lsp.md` — one native `dbt lsp` per Declared Project owns completion, diagnostics, hover, navigation, references, rename, formatting, code actions, and semantic information. Panels call LSP commands first and read Fusion artifacts only where the protocol lacks data. The parallel manifest-driven language providers and parse loop are removed.
- `docs/adr/0003-scope-services-to-declared-projects.md` — auto-serve a workspace-folder root containing `dbt_project.yml`; explicit folder-scoped project paths handle nested layouts; one LSP process per Declared Project; no recursive discovery; a Dependency Project gets no independent editor service.
- `AGENTS.md` and `CLAUDE.md` in this repository are already fork documents pointing at `CONTEXT.md`, `docs/adr/`, and `docs/refactor/`. They state that the shipped extension never invokes mise or Just, and that PRs must pass `just check` and `just package`. Honor both. The upstream Altimate architecture guide they replaced is gone; do not reintroduce it.
- Reviewed research this plan integrates. It holds the evidence, measurements, and rationale; this plan holds decisions, contracts, order, and verification. Do not restate one in the other.
  - [`vscode-webview-architecture-north-star-september-2026.md`](../research/vscode-webview-architecture-north-star-september-2026.md) — measured VSIX, payload, dependency, and compatibility baseline; the webview north star; the deferred runtime and renderer decisions.
  - [`modern-webview-ui-september-2026.md`](../research/modern-webview-ui-september-2026.md) — React 19 and Tailwind 4 candidate verdicts against this codebase, and the practice that decides D8.
  - [`dbt-fusion-interactive-data-path-september-2026.md`](../research/dbt-fusion-interactive-data-path-september-2026.md) with its [sources ledger](../research/dbt-fusion-interactive-data-path-september-2026-sources.md) — the latency budget, the adapter and Cloud finding, the publication epoch, the cache prohibitions, and the Snowflake constraints.
- `/Users/daniel/projects/finance-pipelines/AGENTS.md` — prose rules that apply here too: no issue or PR numbers in code or docstrings; inline comments only for a local gotcha; contracts in docstrings; rationale in `docs/`; lines under 120 characters in code and comments; one physical line per Markdown prose paragraph; no mannered prose or metaphor.

### 2.2 Accepted product decisions (restated so this plan stands alone)

1. Identity: publisher and name `danielchawkins.fusion-power-user`, display name `Fusion Power User`.
2. Independent MIT product fork. Cherry-pick upstream fixes selectively; do not optimize for upstream compatibility.
3. Fusion-only, minimum dbt Fusion 2.0.5. No upper bound; on an untested future major, warn once and continue.
4. Local-only. Do not bypass Fusion licensing; expose only capabilities available locally without extension-specific authentication.
5. Native Fusion LSP owns editor intelligence. One reverse-socket `LanguageClient` per Declared Project. LSP-first metadata; artifacts only where the LSP lacks data; no parallel parse loop.
6. Project config: auto-activate a workspace-folder root containing `dbt_project.yml` when no explicit config exists; also accept folder- and resource-scoped explicit relative project roots; no recursive discovery; Dependency Projects get no independent service; Project Context must switch correctly in multi-root windows. Dependency diagnostics: research normal Fusion behavior; provisional policy is to suppress dependency-file noise while preserving a project-level blocker.
7. Fusion LSP linting on by default. Expose LSP formatting and code actions, but let repository or user settings decide format-on-save.
8. Executable resolution is tool-manager-neutral: `dbt` on `PATH` plus a configurable path. Make `mise-vscode` integration easy through its binary-extension mechanism; never invoke or require `mise`. Use the inherited environment and dbt's project-root `.env` behavior, with a folder-scoped `envFile` override only if justified. No credential prompts or storage.
9. Notifications: silent startup. Only user-invoked actions and blocking configuration failures may notify. Everything else goes to the status bar, an output channel, or Problems.
10. Conflict: if upstream Power User is installed, do not start; show one actionable blocking error. Consumer setup removes upstream.
11. Retain in the comprehensive target: standard LSP features; compile / preview / run / build / test; model and column lineage; model trees; local documentation editor; query results, CTE preview and profiler, charting; local model generation and defer where Fusion supports them.
12. Migration: small focused revisions with green PR bookmark tips — characterization tests, LSP behind an internal boundary, switch consumers, then delete old paths and dependencies. No big-bang rewrite.
13. Distribution: GitHub Release VSIX with checksum, pinned by the consumer. `finance-pipelines` setup installs it into Cursor and VS Code when each CLI exists. New `fusionPowerUser.*` namespace with a documented migration and no fallback reads of `dbt.*`.
14. macOS only initially. Defer a generic socket-to-stdio bridge but keep transport code reusable.
15. The full target is comprehensive. Sequence alpha and beta prereleases for testing; do not drop target features because the first alpha is small.

### 2.3 Verified facts about the current fork

Branch `fusion-lsp-client` is based on upstream `0.64.6`. No LSP code exists; `vscode-languageclient` is not a dependency. The line and contribution counts taken at fork time — ~44k lines in `src`, ~19k in `webview_panels/src`, 66 commands, 33 configuration properties — predate the Phase 3 removals and are not current. The package identity is `danielchawkins.fusion-power-user` / `Fusion Power User` at `0.2.0-alpha.0`; command IDs and settings intentionally retain their upstream namespaces until Phase 9.

**The tooling baseline is green and must not be redone.** In place: `mise.toml` selecting Node 24 and current contributor CLIs with a committed lock; `scripts/workspace/setup/setup-environment.sh` bootstrapping mise and Just; root and webview Just files owning setup, build, format, lint, test, package, and jj workflows; package scripts exposing package-local operations and required lifecycle hooks; dprint and rumdl owning the 27 maintained Markdown files; and `just check` chaining compile, root and webview lint, code- and shell-format checks, ShellCheck, both npm lockfile validations, 637 unit tests, and Markdown checks. Root and webview dependencies install with `npm ci`. The single macOS CI job uses SHA-pinned actions, runs the same checks and package gate, emits a SHA-256 checksum, uploads the VSIX, and cancels superseded runs. Marketplace, OpenVSX, Slack, hosted Altimate dispatches, the upstream documentation site, and upstream contributor automations are deleted. Lefthook replaces Husky and lint-staged; `.agents/skills/` carries `configure-mise`, `justfile-expert`, `jujutsu`, and `write-skill`.

Load-bearing product structure the plan depends on:

- `src/extension.ts` → `src/dbtPowerUserExtension.ts` (`DBTPowerUserExtension.activate`) is the single activation path. It constructs fifteen collaborators through Inversify and calls `detectDBT()` then `initializeDBTProjects()`.
- `src/inversify.config.ts` holds every factory binding. Step 3.1 collapsed the integration-mode switches, so Fusion is the only reachable `DBTProjectIntegration` at runtime.
- Before 4.4, `src/dbt_client/dbtWorkspaceFolder.ts` implemented recursive discovery through `workspace.findFiles`, `allowListFolders`, and `DBTProjectDetection.discoverProjects`. Phase 4 replaced it with Declared Projects.
- `src/dbt_client/event/manifestCacheChangedEvent.ts` declares `ManifestCacheProjectAddedEvent`, carrying the project handle, the eleven metadata maps whose types (`NodeMetaMap`, `MacroMetaMap`, `SourceMetaMap`, `GraphMetaMap`, `TestMetaMap`, and the rest) come from `@altimateai/dbt-integration`, and `modelDepthMap`. Every panel, tree view, lineage view, and code lens consumes it through `src/services/queryManifestService.ts`, which keys by project root and serves `getEventByCurrentProject()` and `getEventByDocument()`. The interface is declared in this repository, so stamping it is a local change.
- **The manifest producer, the ambient target watcher, and the Cloud dependency are one external object.** `DBTProjectIntegrationAdapter` from `@altimateai/dbt-integration` is constructed in `src/inversify.config.ts` and consumed by `src/dbt_client/dbtProject.ts`. It owns the parsers, emits `MANIFEST_PARSED`, and runs a private non-recursive `fs.watch` over the target directory behind a 300 ms debounce; none of the watcher members is public, so the behavior cannot be disabled from here. Its constructor takes Core, **Cloud**, Fusion, and Core-command integration factories as mandatory positional parameters, and this repository supplies all four.
- **The published Fusion integration does not extend Cloud.** `DBTFusionCommandProjectIntegration extends DBTBaseProjectIntegration`, a sibling of `DBTCloudProjectIntegration`, and `src/inversify.config.ts` constructs it directly with no Cloud type in the chain. There is no reparenting task. Cloud is nonetheless undeletable while the adapter remains, because the adapter's constructor requires a Cloud factory. **Retiring the adapter is the hardest ordering constraint in the plan**, and it discharges the manifest parse loop, the ambient watcher, and the Cloud requirement in one step. Do not patch `node_modules`: the edit is invisible to review, lost on reinstall, and diverges the built artifact from the declared dependency.
- Hosted and Python remnants still referenced across `src`: `AltimateRequest`, `SharedStateService`, `PythonEnvironment`, and `ValidationProvider`. The integration classes for Core and Cloud live in `@altimateai/dbt-integration`, not in `src`, so removing them is deleting construction and dropping the dependency rather than deleting files.
- Tests are Jest with a hand-written VS Code mock (`src/test/mock/vscode.ts`); `@vscode/test-electron` runs `src/test/integration/**` under `just test-integration`, outside `just check`. `webview_panels` has no unit or component tests.

### 2.4 Verified facts about the dbt Fusion LSP

Established by inspecting `dbt lsp --help` and the strings of the Fusion 2.0.5 binary at `~/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.5/dbt`. `dbt --version` prints `dbt 2.0.5` — note it does **not** contain the string `dbt-fusion`, which is why the current detection code fails.

Launch surface:

- `dbt lsp --socket <PORT>` — "Socket port to **connect to** for LSP communication". The server is the connecting party, so the extension listens and accepts. This is the reverse-socket transport.
- `--command-prefix <PREFIX>` — namespaces `workspace/executeCommand` command names.
- `--lint-enabled <true|false>` — SQL linter, disabled when unset.
- Project flags: `--project-dir`, `--profiles-dir`, `--profile`, `--target`, `--target-path`, `--packages-install-path`, `--vars`.
- Useful others: `--no-version-check`, `--log-level`, `--log-format`, `--static-analysis`, `--no-manage-state`, `--defer`, `--state`, `--favor-state`, `--threads`.
- Environment the server reads: `DBT_LSP_USE_TARGET_LSP`, `DBT_CLOUD_PUBLICATIONS_DIR`, `DBT_MAXIMUM_SEED_SIZE_MIB`, plus the standard `DBT_*` set.

Advertised server capabilities observed on Fusion 2.0.6 `initialize`: `completionProvider`, `hoverProvider`, `definitionProvider`, `referencesProvider`, `renameProvider`, `signatureHelpProvider`, `documentFormattingProvider`, `documentSymbolProvider`, `codeActionProvider`, `codeLensProvider`, `semanticTokensProvider`, and `inlayHintProvider`. `diagnosticProvider` was absent; S1 and S10 observed no push diagnostics, so diagnostic timing remains unverified. **The provider list is the boundary that makes the editor-provider directories deletions rather than rewrites once their production-shaped flow tests pass.**

`initialize` on Fusion 2.0.5+ advertises seven `executeCommandProvider` commands: `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`, and `dbt.show`.

`dbt.previewCte` and `dbt.goToDefinition` are not advertised; the server returned `null` when they were executed. The official-client capture observed bare `dbt.previewCte` commands in code lenses, so the extension must rewrite them to fork-owned command IDs in Phase 5.6.

Fusion uses standard `window/workDoneProgress/create` and `$/progress`; `dbt/progress/*` strings are tokens, not notification methods. Captured or statically identified retained-feature tokens include `dbt/progress/listNodes` ("Computing Lineage"), `dbt/progress/getCurrentNode` ("Getting Columns"), `dbt/progress/compileFile` ("Compiling File"), and `dbt/progress/show` ("Running Preview"). `dbt.listNodes` is the lineage source and `dbt.getCurrentNode` the column source.

Other observed contracts: code action kinds `source.fixAll` and `source.fixAll.dbtLintFix`; `workspace/configuration` requests for section `dbt` with an `lsp` subsection; a watcher over `**/*.{sql,csv}`; and server-side reads of `.dbtignore`, `.sqlfluff`, and `.sqlfluffignore`. Lineage response shapes appear as `ProjectLineageNodeDto` and `ColumnLineageNodeDto` (`node_name`, `parents`, `transformation_type` in `passthrough` / `transformation` / `raw`, `is_primary_key`), with `MaterializationKindDto`, `AccessDto`, `ResourceTypeDto`, and the failure flags `compilation_failed`, `lineage_query_failed`, and `models_count_is_estimate`.

### 2.5 The consumer repository, and the acceptance suite it already contains

`/Users/daniel/projects/finance-pipelines` is a uv workspace at the git root with a five-folder `finance-pipelines.code-workspace` (`finance_general`, `finance_sox`, `local_packages`, `finance_pipelines`, `repo`). Only two of those folders are dbt projects. Fusion comes from `mise.toml` as `"aqua:getdbt.com/dbt-fusion" = "latest"` with `lockfile = true`.

`scripts/patch_dbt_power_user_macro_hover.py` patches the installed upstream bundle in place, re-applied by a `power-user-patch` task with `runOn: folderOpen` in both dbt folders' `tasks.json`. **Its seven edits are a field-tested statement of what the fork must fix natively, and they become the fork's characterization suite in Phase 2:**

| # | Upstream defect                                                                                                                                                        | Where the fork fixes it                                                          |
| - | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1 | `MacroHoverProvider` reads the hovered word with the default word regex, so a dotted `package.macro` never resolves against a `macroMetaMap` keyed `<package>.<macro>` | Deleted with the provider; the LSP resolves dotted macros. Assert via LSP hover. |
| 2 | Fusion detection requires `dbt-fusion` in `--version` stdout, but Fusion 2.x prints `dbt 2.0.5`                                                                        | Version gate, Phase 1                                                            |
| 3 | `allowListFolders` is read with no folder URI, so a window-level value hides folder values                                                                             | Folder-scoped config reads, Phase 4                                              |
| 4 | Lineage and hover resolve no project for a file outside any dbt project                                                                                                | Project Context resolution, Phase 4                                              |
| 5 | Discovery's own `findFiles` exclude replaces `files.exclude`, so Dagster's `.local_defs_state` project copy is registered and parsed                                   | No recursive discovery, Phase 4                                                  |
| 6 | Discovery runs on every workspace folder, including Dagster-only folders with no `dbt_project.yml`                                                                     | Declared Project model, Phase 4                                                  |
| 7 | A `.code-workspace` cannot disable an extension, so `dbt.enabled` had to be injected into `activate`                                                                   | First-class `fusionPowerUser.enabled`, Phase 1                                   |

Consumer tooling worth knowing: `lefthook.yml` runs per-glob staged checks and a full `just check` on pre-push; the root `justfile` dispatches to module justfiles and exposes `fmt` / `lint` / `check` at every scope; setup is POSIX `sh` scripts under `scripts/workspace/setup/` that each accept `--force`, print `usage:` on `--help`, skip work when the tool is already present, and verify by running the tool's `--version`; `tests/test_setup_scripts.py` asserts every entrypoint's `--help` exits 0 and prints `usage:`; CI is a reusable `_checks.yml` using `jdx/mise-action` with SHA-pinned actions.

### 2.6 The reframing

Two observations collapse a large amount of the apparent work. Both are load-bearing; read them before starting.

**Keep the existing metadata event as the internal boundary and swap only its producer.** ADR 0002 could be read as "replace the metadata layer", which would mean rewriting every panel, tree view, and lens. It does not have to. `ManifestCacheProjectAddedEvent` plus its map types is already the boundary, and `QueryManifestService` is already the mediator. Introduce a `ProjectMetadataSource` port whose output is exactly that event, ship a Fusion-LSP-backed implementation of it beside the existing adapter-backed one, flip a single internal switch, then retire the producer. Every consumer is untouched, the switch is testable from both sides with the same assertions, and an entire "migrate the consumers" phase disappears. Publication metadata is added to the same event rather than to a new interface — see step 6.0. Do not introduce a competing snapshot interface; a second seam doing the same job is the duplication this reframing exists to avoid.

**One retirement discharges four constraints.** The parse loop, the ambient target watcher, the mandatory Cloud factory, and the Core and Python execution strategies all live behind `DBTProjectIntegrationAdapter`. Treating them as four deletions produces four orderings that cannot all be satisfied; treating them as one retirement — compose the published Fusion integration directly, with metadata arriving through the port — produces a single step, 7.1, that unblocks Phase 8 entirely. Sequence everything Cloud-shaped after it.

**Editor-provider directories are deletions, not ports.** The Fusion server advertises completion, hover, definition, references, rename, formatting, code actions, semantic tokens, and code lenses. Registering one `LanguageClient` supersedes the corresponding inherited providers after each production-shaped flow test passes. Standard push diagnostics replace validation when observed; until then the inherited validation path is removed only with a green broken-model diagnostic test. The mixed code-lens directory keeps its local panel and documentation commands while rewriting server-emitted bare CTE commands.

### 2.7 Open decisions

**D1 — Reuse of consumer setup conveniences. Resolved.**

The tooling baseline in Section 2.3 is the realized answer: `mise` with a lockfile, `just` as the verb layer, `dprint` plus `rumdl` for Markdown, a macOS-only CI job with SHA-pinned actions, and `just check` as the single gate. Left behind, correctly: uv and Python packaging, the Snowflake CLI and key configuration, the sqlfluff dbt-interface server tasks, the dbt module and `local_packages` layout, Dagster, the Sigma CLI, the dbt JSON schemas, the multi-root `.code-workspace`, pytest conventions, and the branch-deploy CI shape.

The repository pins dbt Fusion 2.0.5 while the Consumer Repository tracks `latest`; this deliberately separates minimum-version compatibility tests from consumer update testing. Lefthook replaces Husky and lint-staged, and its commands dispatch the same lint gates as `just check`. Add `test`, `test-integration`, `smoke`, and `release` recipes only when the first phase that needs each one lands.

**D2 — Fork base version. Resolved.** The branch is rebased onto upstream 0.64.6. The inherited suite now contains 48 test suites and 637 passing tests, and the consumer's characterization cases describe the same upstream generation.

**D3 — Dependency diagnostics policy. Decided: pass through.** S1 observed no dependency diagnostics and therefore no harmful noise to justify filtering or a synthetic blocker. Fusion Power User initially accepts standard server diagnostics unchanged and owns no second diagnostic store. Add a filter only with a production-shaped regression that demonstrates a concrete dependency-diagnostic problem.

**D4 — Folder-scoped `envFile` override.** Decision 8 permits one only if justified. Default to *not* adding it: Fusion already reads the project-root `.env`, and the extension inherits the editor environment. Revisit only if a consumer case fails in Phase 10.

**D5 — Static-analysis mode. Decided: no dbt login.**

Fusion is the local engine, the v2 of dbt Core. The paid product is dbt Cloud, which this extension does not support. The extension never prompts for, stores, or recognizes a login. Warehouse credentials stay in the user's own `profiles.yml`, which Fusion reads. `off`, `baseline`, and `strict` are launch arguments. The mode is a launch argument and a status surface, so step 5.0 lands before any client starts.

| Mode                 | What the server is asked to do                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`                | Skip SQL analysis for the model and its descendants                                                                                                                                                     |
| `baseline` (default) | Jinja, YAML, and SQL syntax diagnostics; ref and source navigation; table-level lineage; ref autocomplete                                                                                               |
| `strict`             | Baseline, plus column-level lineage, SQL type and schema diagnostics, column go-to-definition, `select *` hover, and rename, when Fusion provides them from the local project and the warehouse profile |

S10 did not establish the runtime difference between `baseline` and `strict`. Step 5.0 records the configured mode and supplies the launch argument; effective mode stays `unknown` without positive server evidence, and configuration alone never enables a strict-only capability. Provider replacement proceeds behind production-shaped tests of the capabilities Fusion advertises. Warehouse- and strict-dependent enhancements remain deferred until positive runtime evidence.

**D6 — Webview UI runtime. Deferred to the v2 measured comparison.** React 19 with `@vscode-elements/elements` is the provisional default so that v1 is not blocked; it is not a selection. The live alternative is a coherent Lit and semantic-DOM webview, since VS Code Elements is itself Lit and needs no React wrapper. Svelte and Solid remain possible but require a measured advantage over the cost of rewriting three panels; no such measurement exists, and none is claimed. The comparison runs at v2.2, behind the contract and per-panel entry seam that v2.1 establishes, on the three retained panels, with the incumbent React implementation as the control. Do not record React as chosen.

**D7 — Lineage renderer. Unselected.** `@xyflow/react` with `elkjs` or `dagre`, `cytoscape`, and `sigma` with `graphology` are the candidates. The deciding inputs are the node, edge, and per-node column distributions of real Declared Projects, which nobody has recorded, and whether column-level lineage is expressible in each renderer. Because `@xyflow/react` couples the renderer to the runtime, run this benchmark jointly with D6.

**D8 — Tailwind's fate. Conditional on the lineage replacement's styling contract.** No owned source uses a Tailwind utility; the generator exists solely to emit the `al-` selectors `@altimateai/ui-components` references at runtime, and its output ships as a webview asset. So Tailwind 3 generation is preserved until the replacement's contract is known, and then exactly one of: delete the toolchain, if the replacement ships its own compiled CSS and no consumer needs generated utilities; or write a fresh Tailwind 4 configuration against the new contract, retiring the hand-adapted Preflight into supported configuration. The current `al-` generation is never migrated, and generated utility output is never hand-ported or vendored; the blocker record holds the spike evidence for why a port is unavailable.

### 2.8 Artifact, cache, and measurement policy

These bind every step below. They restate ADR 0002 rather than amend it.

**Three artifact reads are sanctioned; a fourth is prohibited.** Panels call LSP commands first. Beyond that: a **safe post-command read** of an artifact written by a command this extension launched and awaited; a **documented capability-gap fallback** where the protocol genuinely cannot supply the data, recorded in the gap table from step 6.2; and an **explicit prior-state import**, a user-selected artifact compared against a prior state. Prohibited: **ambient artifact watching** — no component subscribes to `target/` and republishes project state on an arbitrary external write. The existing ambient watcher is private to `DBTProjectIntegrationAdapter` and is removed by retiring it at step 7.1, not as a standalone deletion and not by patching `node_modules`. Do not claim that every current artifact read is broken: the awaited-parse-then-read path is sound, and a failed read degrades to the previous projection rather than to corrupted state.

**Validated reads, wherever an artifact is read:** `stat`, read, `stat` again, compare size and `mtime_ns`, hash, parse. If the two stats differ a writer was active — retry with backoff and surface a bounded failure. Treat a parse failure as "writer in flight", not "corrupt file". The engine's manifest writer truncates in place and streams with no rename, so publication is not atomic.

**Never write into the project's `target/`.** It is the engine's output directory. The constraint is ownership; do not attach a parse-cache-invalidation rationale to it, which is unsupported.

**Two cache prohibitions, stated narrowly.** Do not recreate compiler truth: the extension must not derive or reconstruct parse, compile, or schema results a producer is responsible for. Do not persist derived compiler state to disk. Both rest on the producer already owning invalidation with keys the client cannot observe — config content hashes and the engine's own binary version among them — not on any claim that the producer's caches outperform a client's. **Bounded in-memory retention of LSP responses and panel projections is permitted** and violates neither. No extension-owned persisted compiler, schema, or query-result cache, and no second diagnostic store beside the language client's `DiagnosticCollection`.

**Query results and warehouse behavior.** Hold the open tab's rows in memory and drop them when the tab closes; never persist rows, compiled SQL, credentials, or environment values. Reuse comes from Snowflake, which requires exact query-text match plus unchanged data, micro-partitions, and role privileges — three conditions a local cache cannot implement. So keep submitted SQL byte-identical for a given logical query; a comment with constant text is acceptable and one embedding a timestamp, invocation id, or run id defeats reuse permanently. `QUERY_TAG` is a separate mechanism, set by `ALTER SESSION` and not part of statement text, so tagging costs nothing — if Fusion exposes it, which S9 establishes. Keep "result cache" and "warehouse data cache" lexically distinct; never write "the Snowflake cache".

**Panel persistence is UI state only.** Each panel that persists through `getState`/`setState` declares a schema of view state and nothing else: scroll and selection position, expanded or collapsed nodes, active tab, sort and filter choices, panel layout, and the epoch the view was rendered against so a restore can revalidate. Prohibited in that schema, without exception: result rows or any sample of them, SQL text compiled or submitted, credentials or tokens, Snowflake query ids, warehouse or schema metadata and anything derived from it, and compiler payloads. Webview state is host-persisted storage this product does not encrypt, and a restore must fail closed by revalidating rather than by reusing data.

**No performance claim precedes its measurement.** Every target is derived from the baseline harness in step 3.13, expressed as a per-segment percentile against a recorded baseline. Arbitrary numeric targets do not belong in this plan.

### 2.9 Operation routing

A single Fusion language server is authoritative for editor intelligence: realtime completions, hovers, definitions, references, renames, formatting, code actions, lenses, and diagnostics. Direct CLI invocations of Fusion are used only when no suitable LSP capability exists — `run`, `build`, `test`, `deps`, `seed`, `snapshot`, and the `show --inline` fallback — always through the same resolved executable and launch context (cwd, environment, profile, target). The target architecture does not run direct parse or compile in parallel with the server to manufacture editor state; use LSP `didOpen` compile and validated artifacts only. The inherited parse loop and target watcher remain until 6.3 and 7.1 retire them. Phase 7 introduces the operation layer that enforces this routing.

## 3. Phases

Each step is one PR bookmark, normally containing several focused revisions. Every step lists the files it touches, the contract at its seam, and its bookmark-tip verification.

### Phase 0 — Close the tooling baseline — **complete**

**0.1 — Rebase onto the chosen base — complete.** The branch is based on upstream 0.64.6. Root and webview dependencies install with `npm ci`; `just check` and `just package` pass.

**0.2 — Pin Fusion and record the tooling decision — complete.** `mise.toml` pins dbt Fusion 2.0.5, `mise.lock` records both supported macOS archive checksums, and [`0004-repository-tooling.md`](../adr/0004-repository-tooling.md) records the decision.

Verify: `mise install` resolves 2.0.5; `dbt --version` under `mise exec` prints `dbt 2.0.5`; `just check` green.

### Phase 1 — Identity and activation gates

**1.1 — Product identity — package metadata complete.** Touch `package.json` (`name`, `displayName`, `publisher`, `description`, `version` → `0.1.0-alpha.0`, `icon`, `repository`, `homepage`, `bugs`, `categories`, `keywords`; drop `extensionDependencies` on `ms-python.python`, `altimateai.vscode-altimate-mcp-server`, and Better Jinja; ship bundled `jinja-sql` grammar and YAML injection under this extension's identity; remove the `deploy-vscode` and `deploy-openvsx` scripts and the `ovsx` devDependency), delete the unused `package.nls.json`, and rewrite `README.md` to distinguish the current developer alpha from the local-only target. Retain the MIT and upstream copyright in `LICENSE`, remove stale Altimate identity assets, and delete `CONTRIBUTING.md`, `sweep.yaml`, `codecov.yml`, `.gitpod.yml`, `.nycrc.json`, and `documentation/`.

Leave command IDs and setting keys on `dbtPowerUser.*` / `dbt.*` for now; they move in Phase 9 as one coordinated rename.

Contract: the package identifier is `danielchawkins.fusion-power-user`. Runtime references to the upstream identifier remain only where later phases remove hosted behavior or add the explicit conflict guard; Phase 9 completes the coordinated command, setting, URI, and marker namespace rename.

Verify: `just package` produces `fusion-power-user-0.1.0-alpha.0.vsix`; `package.json` carries only the fork package, publisher, repository, homepage, and bug tracker identity; `just check` is green.

**1.2 — Fusion version gate — complete.** Wrap detection in `src/fusion/` rather than patching `DBTFusionCommandDetection` in `@altimateai/dbt-integration`.

Contract, in a new `src/fusion/fusionVersion.ts`:

```ts
export type FusionVersion = { major: number; minor: number; patch: number; raw: string };
export const MINIMUM_FUSION = { major: 2, minor: 0, patch: 5 };
export type FusionVersionVerdict =
  | { kind: "ok"; version: FusionVersion }
  | { kind: "untestedMajor"; version: FusionVersion }   // warn once, continue
  | { kind: "tooOld"; version: FusionVersion }          // blocking
  | { kind: "notFusion"; raw: string }                  // blocking
  | { kind: "notFound"; attemptedPath: string };        // blocking
export function parseFusionVersion(stdout: string): FusionVersion | undefined;
export function judgeFusionVersion(v: FusionVersion | undefined, raw: string): FusionVersionVerdict;
```

`parseFusionVersion` must accept `dbt 2.0.5` — the actual Fusion 2.x output — and must reject dbt Core's `installed: 1.x` shape. Do not require the literal `dbt-fusion`. "Warn once" means once per extension installation per major version, keyed in `ExtensionContext.globalState`.

Verify: unit tests in `src/test/suite/fusionVersion.test.ts` covering real `dbt 2.0.5` output, `dbt 3.0.0` (untested major), `dbt 2.0.4` (too old), a dbt Core `--version` block (not Fusion), and empty stdout. This closes consumer characterization case 2.

**1.3 — Conflict guard and `enabled` setting — complete.** In `src/dbtPowerUserExtension.ts`, before any other activation work: if `extensions.getExtension("innoverio.vscode-dbt-power-user")` is defined, show one blocking error naming the conflicting extension and offering an "Uninstall Power User" action that runs `workbench.extensions.uninstallExtension`, then return without registering anything. Separately, return early when the resource-scoped `enabled` setting is false.

Contract: both are decided before `detectDBT()`; neither starts a process, registers a provider, or creates a watcher. The conflict error is the one notification permitted at startup.

Verify: unit tests asserting no disposables are registered and no process is spawned in each case. This closes consumer characterization case 7 and makes the consumer's injected `dbt.enabled` patch unnecessary.

---

### Phase 2 — Characterization tests — **complete**

Goal: lock in current behavior at the seams about to move, and encode the consumer's field-observed defects as failing tests that later phases turn green. No production code changes in this phase. All four steps are on `main`; they are retained here because later phases are verified against them.

**2.1 — Fixture workspaces — complete.** Add `src/test/fixtures/`:

- `single-project/` — one root with `dbt_project.yml`, `models/`, a `profiles.yml`, one deliberately broken `ref()`.
- `multi-root/` — mirrors the consumer: `projects/general/` and `projects/sox/` as dbt projects, a `shared_packages/` non-project folder holding macros, a `pipelines/` folder with no `dbt_project.yml`, and a `projects/general/.state_copy/` containing a complete copy of a dbt project to reproduce the `.local_defs_state` case.
- `nested-project/` — a repository root that is *not* a dbt project with the project two levels down, for the explicit relative-root path.

Contract: fixtures are the shared vocabulary of every later test. Do not fork them per suite.

Verify: a smoke test asserts each fixture parses as YAML and that `multi-root` has exactly two real project roots plus one copy.

**2.2 — Integration harness — complete.** `src/test/integration/` is driven by the existing `@vscode/test-electron` devDependency, and a `just test-integration` recipe. The harness opens a fixture as a workspace, waits for activation, and exposes helpers to read diagnostics, request completions, and send `executeCommand`. Add `src/test/integration/lspFixture.ts` that can spawn `dbt lsp` directly against a fixture and speak LSP over the reverse socket without the extension, so protocol behavior can be characterized independently of extension bugs.

Contract: `just test-integration` requires the pinned Fusion on `PATH` and skips with a clear message otherwise; it never runs inside `just check`. Fusion 2.0.5 does not load a project-root `profiles.yml` on its own — pass `--profiles-dir` (or `DBT_PROFILES_DIR`) as the fixture's project directory, which already holds a dummy `profiles.yml`.

Verify: one integration test asserts the extension activates on `single-project` and that `dbt --version` resolves to Fusion 2.0.5.

**2.3 — Project scoping characterization — complete.** This step captured consumer cases 3, 4, 5, and 6: a folder-scoped setting value must win over a window-level value; a file outside any project must resolve a Project Context; a copied project tree must not register; and a workspace folder without a root `dbt_project.yml` must register nothing and create no watcher. Phases 4.1 through 4.4 moved those assertions to the configuration, registry, and context seams, then deleted the obsolete `projectScoping.test.ts` and its expected failures with `DBTWorkspaceFolder`.

Verify: the migrated assertions pass at their final seams; no expected-failure scoping test remains.

**2.4 — Metadata contract snapshot — complete.** `src/test/suite/metadataContract.test.ts` builds a `ManifestCacheProjectAddedEvent` from the `single-project` fixture's `manifest.json` through the existing parsers and snapshots the resulting `NodeMetaMap`, `MacroMetaMap`, `SourceMetaMap`, `GraphMetaMap`, and `TestMetaMap` entries.

Contract: this snapshot is the acceptance test for the LSP-backed producer in Phase 6. Both implementations must satisfy the same assertions. Snapshot the *shape and key set*, not volatile values such as absolute paths or checksums.

Verify: snapshot committed; suite green.

---

### Phase 3 — Cut the unreachable subsystems → **alpha.1**

Goal: remove everything with no retained-feature consumer, before the hard work starts. This is the cheapest large reduction available and it shrinks the surface every later phase must reason about. Nothing here depends on the LSP.

Order within 3.1 through 3.6 matters only in that 3.1 makes the rest smaller. The webview steps 3.8 through 3.15 that follow 3.7 carry explicit dependencies, stated with each step.

**3.1 — Pin the integration to Fusion.** In `src/inversify.config.ts`, collapse the three `switch (dbtIntegrationMode)` factories to return the Fusion implementations unconditionally. Remove the `dbt.dbtIntegration` setting and the reload-on-change handler in `src/dbtPowerUserExtension.ts`. Remove `dbtPowerUser.switchDbtIntegration` and `dbtPowerUser.installDbt` and the integration branches in `src/dbt_client/index.ts`. **Leave the Core and Cloud factories bound** — `DBTProjectIntegrationAdapter`'s constructor requires them, and retiring the adapter is Phase 7 step 7.1. Dead-but-constructible is the correct intermediate state.

Contract: exactly one `DBTProjectIntegration` implementation is reachable at runtime.

Verify: `src/test/suite/dbtCloudDetection.test.ts` and `dbtCoreDetection.test.ts` deleted or narrowed; `just check` green; integration test on `single-project` still activates.

**3.2 — Remove notebooks.** Delete `src/lib/` (`index.js` and `index.d.ts`, the bundled notebook kernel), `src/quickpick/notebookQuickPick.ts`, `altimate_notebook_kernel.py`, `webview_panels/src/modules/notebooks/` and `webview_panels/src/notebook/`, the `notebooks`, `notebookRenderer`, and `customEditors` contributions and the six `dbtPowerUser.showNotebook*` and `dbtPowerUser.createDatapilotNotebook` commands in `package.json`, and `postInstall.js` and `prepareBuild.js`. Drop the dependencies `@jupyterlab/coreutils`, `@jupyterlab/nbformat`, `@jupyterlab/services`, `@nteract/messaging`, `zeromq`, and the devDependency `@vscode/zeromq`; remove the `postinstall` script and the `@lib` path alias from `tsconfig.json`, `rsbuild.config.ts`, and `jest.config.js`, and delete `src/test/mock/lib.ts`.

Contract: the built VSIX contains no native binaries. This is also what makes a single-platform VSIX honest.

Verify: `just check` and `just package` green; `find` over the unpacked VSIX yields no `.node` files; `npm ci` no longer runs a postinstall.

**3.3 — Remove AI and the DataPilot surface.** Delete `src/dbt_client/datapilot.ts`, `src/webview_provider/datapilotPanel.ts`, `src/webview_provider/newDocsGenPanel.ts`, `src/services/queryAnalysisService.ts`, `src/services/streamingService.ts`, `src/commands/sqlToModel.ts`, `src/webview_provider/sqlLineagePanel.ts`, `webview_panels/src/modules/dataPilot/`, and the corresponding commands (`openDatapilotWithQuery`, `summarizeQuery`, `changeQuery`, `translateQuery`, `sqlToModel`, `resetDatapilot`, `maximizeDatapilot`, `showHelpDatapilot`, `datapilotProfileYourQuery`, `sqlLineage`, `createSqlFile`, `sqlQuickPick`). Drop `@vscode/chat-extension-utils`.

Note: `docGenService.ts` is *not* deleted here. Split it — the AI generation paths go, the local schema-YAML scaffolding that `generateSchemaYML` uses stays and is rebased in Phase 7.

Verify: `just check` green; `grep -ri datapilot src webview_panels/src` empty.

**3.4 — Remove MCP.** Delete `src/mcp/`, its construction in `src/dbtPowerUserExtension.ts` and `inversify.config.ts`, and the `dbt.enableMcpDataSourceQueryTools`, `dbt.mcpSslCertPath`, and `dbt.mcpSslCertKeyPath` settings. Drop `@modelcontextprotocol/sdk`, `zod-to-json-schema`, `express`, and `@types/express`.

Verify: `just check` green; `grep -ri "mcp" src package.json` empty.

**3.5 — Remove collaboration, governance, and hosted discovery.** Delete `src/comment_provider/`, `src/services/conversationService.ts`, `src/services/usersService.ts`, `src/commands/altimateScan.ts`, `src/webview_provider/insightsPanel.ts`, `src/webview_provider/DbtDocsView.ts`, `dbt_healthcheck.py`, `webview_panels/src/modules/{insights,healthCheck,feedback,previewFeature,newFeature,dbtDocs}/`, and the commands `resolveConversation`, `createConversation`, `replyToConversation`, `viewInDbtDocs`, `copyDbtDocsLink`, `altimateScan`, `clearAltimateScanResults`, `openInsights`, `showDocumentation`, and `bigqueryCostEstimate` (with `src/commands/bigQueryCostEstimate.ts`). Remove `dbt.enableCollaboration`, `dbt.disableQueryHistory`, and `dbt.conversationsPollingInterval`. Drop `parse-diff` and `dayjs` if nothing retained uses them.

Verify: `just check` green; the remaining panel routes in `webview_panels/src/modules/AppRoutes.tsx` resolve.

**3.6 — Remove telemetry.** This is the widest change in the phase (51 files) and must be mechanical. Delete `src/telemetry/`, drop `@vscode/extension-telemetry`, and remove every `TelemetryService` constructor parameter and call site. Do not leave a no-op shim: a silent sink invites new call sites. Where a `sendTelemetryError` call was the only error handling, replace it with a `DBTTerminal` error log.

Contract: no network egress from the extension for any reason. After this step, `grep -rn "fetch\|http" src` should surface only code slated for removal in Phase 8.

Verify: `just check` green; `grep -rn "telemetry" src -i` empty; integration test on `single-project` still activates.

**Release alpha.1** (`0.1.0-alpha.1`). Still manifest-driven and not yet useful for the LSP goal, but it is the first artifact that is unambiguously local-only and installable, and it exercises the release pipeline early. Bring Phase 9 step 9.4's release workflow forward if this phase finishes first.

**3.7 — Latest majors (`chore/latest-majors`).** After 3.6, before Phase 4. The only compatibility ceiling is the Extensions API this product declares: `engines.vscode` and `@types/vscode` are the newest version both VS Code and Cursor actually support (Confirm if those diverge; take the intersection). The first pass upgrades or replaces dependencies where that fits the inherited architecture without derailing the product refactor; it does not bless that architecture as the target. Node, npm, TypeScript, the extension host module format, Inversify, React, ESLint, Vite, and every other direct dependency are fair game. Do not retain an older format or tool merely because it is lower risk or supports older hosts. Separately research the 2026 extension and webview landscape, choose a north-star architecture by functionality and measured activation, runtime, bundle-size, webview-startup, and build performance, and schedule larger rip-and-replace work for v2 when it does not fit the current phases. Migrate `moduleResolution` off `node`/`node10` (`nodenext` or `bundler` as the compiler/bundler requires). No `ignoreDeprecations`. `engines.node` is `>=<current LTS major> <next major>`. Leave Fusion at 2.0.5 in `mise.toml`. SHA-pinned GitHub Actions stay SHA-pinned. Split into more than one PR if a single change is too large; do not leave leftovers unscheduled. `just check` and `just package` green.

**Tooling after 3.7 (not a gate).** Evaluate a report-only `just lint-complexity`. Do not add it to `just lint`, `just check`, Lefthook pre-push, or CI. Promoting it to a gate is a later Confirm, not before Phase 8.

#### Webview reduction, steps 3.8 through 3.15

Bounded work from the reviewed north-star research, landing beside the Phase 3 deletions and not redone in v2. Its measured baseline — VSIX composition, eager payload, vendored bundle size, advisory counts — is in that research and is not restated here. The order below is dependency order, not preference: a retained consumer gets its replacement before the thing it consumes is deleted, and a dependency is pruned only once nothing imports it. Each step is one PR bookmark that is independently green. Nothing here touches the lineage panel, the Tailwind generation, `@altimateai/ui-components`, or the Python payload. The three panels that survive are lineage, query results, and the documentation editor.

**3.8 — Replace the retained vendored capabilities.** Implement `webview_panels/src/uiCore/components/codeblock/` locally, keeping its current prop interface so its call sites across the query panel, documentation editor, and markdown renderer are untouched; `language`, currently typed off the vendored function's parameters, becomes an explicit union. Separately replace the one `noop` import from `antd/es/_util/warning` in `documentationEditor/components/saveDocumentation/SaveDocumentation.tsx` with a local definition. What needs replacing is the `CodeBlock` *capability*, not the `react-code-blocks` package, which nothing imports and which step 3.10 deletes.

Contract: no call site of `CodeBlock` changes. This step gates 3.9 and unblocks the `antd` removal in 3.10.

Verify: `just check`; the Storybook stories covering the code block render; `grep -rn "antd" webview_panels/src/modules/documentationEditor` empty.

**3.9 — Delete the hosted webview surfaces and the vendored bundle.** Delete `TeamMateProvider` from `App.tsx` and the `ApiHelper.get` / `ApiHelper.post` reassignment in `modules/app/AppProvider.tsx`; delete the onboarding, What's New, and Home modules with their extension-host providers, routes, and settings, including the `installDbt` command the product boundary forbids; then delete `webview_panels/src/lib/` with **both** of its aliases — the `@lib` resolve alias in `webview_panels/vite.config.ts` and the `@lib` entry in `compilerOptions.paths` in `webview_panels/tsconfig.json`. Update `DocumentationEditor.stories.tsx`, which imports `TeamMateProvider`. Official UX guidance rules out webviews for wizards, for opening on update, and for promotions, which is what these three surfaces are.

Contract: after this step no owned source imports `@lib` and no configuration still declares it. **Depends on 3.8.**

Verify: `just check` and `just package`; `grep -rn "@lib" webview_panels/src webview_panels/vite.config.ts webview_panels/tsconfig.json` empty; the remaining routes resolve; record the VSIX size delta.

**3.10 — Prune the orphaned dependencies.** Remove the dependencies with no reference in owned source or configuration, which also clears the Prism advisory chain; those referenced only by the bundle 3.9 deleted; and the `antd` family, unblocked by 3.8 and 3.9. Keep Perspective, the lineage stack, and the Tailwind generation. Nothing else in this step.

Contract: a dependency leaves only when nothing imports it. **Depends on 3.9.**

Verify: `just check` and `just package`; `npm audit` advisory count and installed-instance count recorded against the research baseline.

**3.11 — Prune images and tutorial assets by reference audit.** Delete the unreferenced images under `media/images`, **preserving `media/images/dbt.png` and the SVGs referenced by `contributes.commands[].icon` and the treeview providers**. Confirm file by file the SVGs that no literal name reaches, because an icon path can be assembled from fragments — a grep miss is a broken icon in the packaged product. Delete the tutorial GIFs, both copies, now that 3.9 removed `TutorialsStep` and the `window.tutorialImages` injection in `altimateWebviewProvider.getHtml`.

Contract: every deletion is reference-driven and every preserved icon is named in the PR. **Depends on 3.9.**

Verify: `just package`; every contributed and treeview icon resolves in the packaged VSIX; VSIX size and image share recorded.

**3.12 — Narrow the Codicons copy.** Give the `copy-codicons` plugin in `webview_panels/vite.config.ts` an allowlist of `codicon.css` and the `codicon.ttf` its `@font-face` references. Deleting the emitted files instead is undone by the next build, so the plugin is the only durable place for this. Independent of 3.10 and 3.11.

Verify: `webview_panels/dist/assets/codicons/` holds exactly those two files after a build, and `vsce ls` shows no `codicon.html`.

**3.13 — Webview component tests and the build baseline.** Add Vitest with Testing Library and jsdom to `webview_panels`, a `just` recipe wired into `just check`, and component tests against seams that exist today — the 3.8 code block, the app listener, and one panel's existing `window.addEventListener("message")` handler exercised through the message shapes they accept. **No shared message-contract package and no contract test in v1**: the runtime-validated contract is introduced at v2.1, and a test written against it now would test nothing. Record the two baselines executable without visible-workbench automation:

- **Webview payload, single entry** — raw and gzip bytes of the one bundle every panel loads today, plus its CSS. Per-panel payload is not measurable until v2.1 splits the entries, and is recorded there against this figure.
- **Build and package** — after one warmup, median of three on stated fixed hardware for the webview build, host build, and VSIX; label VSIX time as including prepublish builds and re-measure at each deletion milestone.

Fusion segment timing is not part of the baseline or metadata migration. Add request timing only when an implementation decision has a measured need for it.

Contract: the green component-test harness and committed payload/build record are the deliverable. Targets are derived from the first run, not chosen in advance. Cold workbench activation, real-webview first contentful paint, and host resolve-to-ready are explicitly owned by 3.14; standalone browser or test-code Promise timings are not substitutes.

Verify: `just check` green with the new suite; one committed baseline record per measure above; benchmark scripts leave no VSIX, profile, server, or webview harness output behind.

**3.14 — Pinned-host smoke and runtime baseline.** Add CI jobs that install the packaged VSIX and open each retained panel in **VS Code pinned at 1.128.x**, the engine floor rather than current stable, and in Cursor. Cursor has no download API equivalent to VS Code's, so this step must also document and commit the Cursor acquisition strategy: how the build is obtained, which version is pinned, where it is cached, and how the pin is advanced. Record each run's observed Electron version per editor so a host rebase that lowers it is visible rather than discovered by a user. Use a disposable user-data directory per run so neither host inherits profile state.

The same visible-host automation records: ten fresh-process samples of the host's full extension activation accounting; each webview's browser `first-contentful-paint` relative to its own `timeOrigin`; and host resolve start to that panel's `webview:ready` receipt on the host clock. Keep clocks separate. Test-electron command execution, standalone Chrome, Storybook, and extension-test `activate()` wall time do not satisfy these measures. If supported visible-host/CDP automation cannot produce them reproducibly, stop at this step and record the automation gap; do not proceed to 3.15.

Contract: per-editor results are separately visible, so a Cursor-only failure cannot hide behind a green VS Code run. This step changes no build configuration. Step 9.3 extends this job rather than duplicating it.

Verify: the job passes on both hosts; opens docs, query, and lineage webviews with their CSS, Codicon font, and CSP intact; prints host versions; records raw samples plus median/p90 for each measure; and fails loudly rather than skipping when a host cannot be acquired or a panel does not resolve.

**3.15 — The derived browser target.** Only after 3.14 is green on both hosts. Set `build.target: "chrome148"` in `webview_panels/vite.config.ts` and migrate `rollupOptions` to the `rolldownOptions` that replaces it. Derivation, recorded in the commit message rather than a comment: `engines.vscode ^1.128.0` → VS Code 1.128.0 → Electron 42.5.0 → Chromium 148; Vite's default otherwise downlevels for engines that never run this code. In the same step, attempt deleting the `cssMinify: "esbuild"` override, which now shadows Vite's Lightning CSS default, and keep the deletion only if the generated `al-` selector set survives minification intact and `main.css` does not regress; otherwise restore the override and record why.

Contract: the browser target is a consequence of the declared engine range, never inferred from whichever editor builds happen to be installed. If either host drops below Chromium 148, the target drops with it. **Depends on 3.14**, and the smoke job is what makes the target safe to rely on — landing both at one tip would leave the target unproven on the hosts it claims.

Verify: 3.14's job green at this tip on both hosts; `just package` green; webview payload re-measured against 3.13's baseline.

---

### Phase 4 — The Declared Project model → **alpha.2**

Goal: replace recursive discovery with ADR 0003's model, and turn the Phase 2 failing tests green. Do this *before* the LSP work, because "one LSP process per Declared Project" is meaningless until the set of Declared Projects is correct.

**4.1 — Project configuration resolution.** New `src/projects/projectConfiguration.ts`.

```ts
export type ProjectConfigurationProblem =
  | { reason: "invalidEntry"; entry: string }
  | { reason: "missingProjectFile"; entry: string; root: string };
/** Resolved project roots for one workspace folder, in declaration order. */
export interface DeclaredProjectRoots {
  folder: WorkspaceFolder;
  roots: Uri[];
  source: "explicit" | "folderRoot";
  problems: readonly ProjectConfigurationProblem[];
}
/** Reads `projects` scoped to the folder, falling back to the folder root when it holds dbt_project.yml. */
export function resolveDeclaredProjectRoots(folder: WorkspaceFolder): DeclaredProjectRoots;
```

Rules, all testable without VS Code running: read the setting with `workspace.getConfiguration(SECTION, folder.uri)` so folder values win over window values; interpret each entry as a path relative to the folder, accepting absolute paths; require `dbt_project.yml` at each resolved root; return structured problems naming invalid entries and block all explicit roots when any problem exists; 4.2 reports those problems through the output channel; when the setting is absent or empty, return the folder root if and only if it contains `dbt_project.yml`, otherwise return no roots; never walk the tree.

Verify: closes characterization cases 3, 5, and 6 at the resolver seam. Cases cover an explicit root that does not exist, an absolute root, a root outside the folder, and duplicate entries across folders resolving to the same path. Phase 4.4 moved the remaining scoping assertions onto `ProjectRegistry` and removed the expected-failure suite.

**4.2 — Project registry.** New `src/projects/projectRegistry.ts`. One concrete `ProjectRegistry` class implements the registry seam, bound to `DBTTerminal` and inert until 4.3 calls `initialize()`.

```ts
export interface DeclaredProject extends Disposable {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
  contains(uri: Uri): boolean;
}
export declare class ProjectRegistry implements Disposable {
  readonly projects: readonly DeclaredProject[];
  readonly onDidChangeProjects: Event<void>;
  /** Deepest-root-first match; undefined when the uri belongs to no Declared Project. */
  findProject(uri: Uri): DeclaredProject | undefined;
  /** Registers listeners and creates one non-recursive `dbt_project.yml` watcher per registered root. */
  initialize(): Promise<void>;
  dispose(): void;
}
```

Resolution calls `resolveDeclaredProjectRoots` (4.1) per folder, collects roots, and deduplicates by `realpathSync.native` (fallback lexical) — first folder wins while all declared lexical aliases remain valid for containment. An explicitly declared package root is a Declared Project under ADR 0003; undeclared package trees never enter the registry because it does not discover recursively. `contains` is exact-or-separator-prefix across those aliases. `findProject` uses deepest-segment-first deterministic lookup. Reads project name from `dbt_project.yml` config, basename fallback, parse-error stops that root with an output-channel note. Per-root watchers reconcile on `dbt_project.yml` create/change/delete and on `workspace.onDidChangeConfiguration` when `dbt.projects` changes; `onDidChangeWorkspaceFolders` reconciles the whole set. Reconcile preserves `DeclaredProject` instance identity for unchanged projects, disposes removed ones, fires `onDidChangeProjects` once and only on a net set change. Project-free folders get zero watchers. A missing explicit project file therefore heals on a configuration change or reload, not ambient file creation. No watcher exists before `initialize()`. DI binding in `src/inversify.config.ts` takes `DBTTerminal` only; no activation call or consumer until 4.3.

Verify: registration and names correct per folder and declaration order; fail-closed per folder leaves siblings unaffected; explicitly declared package roots register; deduped-realpath fallback; deepest-first deterministic; no `findFiles` or recursive watchers in the registry; per-root `RelativePattern(root, "dbt_project.yml")` exact count; zero watchers on project-free folders; configuration-change reconcile and event-firing exact. The workspace-wide recursive-watcher assertion turns green in 4.4 when the old discovery subject is removed.

**4.3 — Project Context resolution.** New `src/projects/projectContext.ts`.

```ts
export declare class ProjectContext implements Disposable {
  /** Project owning the active editor, else the project owning the active folder, else the sole project. */
  readonly current: DeclaredProject | undefined;
  readonly onDidChangeCurrent: Event<DeclaredProject | undefined>;
  /** Project owning a specific resource; used by commands that carry a uri. */
  forResource(uri: Uri): DeclaredProject | undefined;
  /** Prompts only when a user-invoked command needs a project and cannot infer one. */
  requireForCommand(uri?: Uri): Promise<DeclaredProject | undefined>;
  dispose(): void;
}
```

Precedence for `current`: the active editor's URI, then the sole Declared Project owned by the active editor's workspace folder, then the single registered project if there is exactly one, then undefined. Never silently default to "the first project" when more than one exists — that is the upstream behavior the Consumer Repository had to patch around, and it produced wrong-project lineage. A user command carrying a file-scheme URI that belongs to no Declared Project does not inherit the sole project; it prompts only when multiple choices exist. A non-file URI such as an untitled buffer falls through to `current`. Cancellation returns undefined. Activate the registry after the conflict and `dbt.enabled` guards and `setContext`, before DBTProject instances initialize. Rewire `src/services/queryManifestService.ts` `getProject`, `getProjectByUri`, `getOrPickProjectFromWorkspace`, and its three manifest-event lookup paths onto Project Context, keeping consumer signatures unchanged; one private mapper resolves the Declared Project root through `DBTProjectContainer`.

Verify: Jest coverage closes characterization case 4 at the Project Context seam: models in each project update `current`, while `pipelines/` resolves undefined with no notification. A transitional zero-registry fallback existed only between 4.3 and 4.4; 4.4 removed it when `DBTProjectContainer` moved onto the registry. Project Context is authoritative: an undeclared nested project is intentionally owned by its declared ancestor under ADR 0003, and Query Manifest maps only the Declared Project root.

**4.4 — Retire the old discovery path — complete.** Deleted `src/dbt_client/dbtWorkspaceFolder.ts` and rewired `src/dbt_client/dbtProjectContainer.ts` onto `ProjectRegistry`. The container now preserves registry order, serializes reconciliation, owns each DBTProject exactly once, and emits removal before disposal. Removed Query Manifest's temporary zero-registry fallback, `dbt.allowListFolders`, the `DBTCoreProjectDetection`, `DBTCloudProjectDetection`, and `DBTFusionCommandProjectDetection` bindings, and the `Factory<DBTProjectDetection>` composition. `DBTCoreCommandProjectDetection` remains with the adapter-backed command integration until that composition retires.

Verify: `just check` green with the Phase 2 scoping behaviors covered through `ProjectRegistry` and no `it.failing`; the obsolete `DBTWorkspaceFolder` tests are removed with their subject; the two dbt folders of `multi-root` behave identically whether opened as a multi-root workspace or individually.

**4.5 — Retire pinned-project resolution fallbacks — complete.** Hover, autocomplete, and code lenses never inherit a prior stored pick; they resolve through the current editor resource and Project Context. The user-invoked `executeSQL` path calls `ProjectContext.requireForCommand()`: it resolves the Declared Project owning a file URI, infers the current or sole project for untitled resources, prompts among multiple projects, and returns without execution on cancellation. The explicit selector and a path-free prompt retain an in-memory choice for later non-file contexts; a choice made for an unrelated file applies only to that command. Workspace-state references remain only as a bridge from the explicit selector to validate/install. Tests verify editor-intelligence isolation, SQL command resolution, cancellation, and retained explicit-pick behavior.

**Release alpha.2** (`0.2.0-alpha.0`). Worth installing in the consumer as a replacement for patch cases 2 through 7 even before the LSP lands: it validates the Declared Project model against the real repository shape while the manifest path still works.

---

### Phase 5 — LSP transport, client, and lifecycle → **alpha.3**

Goal: the first genuinely valuable alpha. Steps 5.0 through 5.4 establish the Fusion client path; 5.5 adopts diagnostic pass-through; 5.6 deletes each inherited provider with its production-shaped replacement test.

Run spikes **S2** (command payloads), **S3**, **S4**, **S5**, and **S6** before the steps that name them, **S10** before step 5.6, and **S1** before step 5.5.

**5.0 — Static-analysis launch selection and the capability matrix.** Gated on **D5** and landed before 5.3 launches any client, because the mode is a launch argument the pool cannot assemble without it. New `src/fusion/staticAnalysisMode.ts`.

```ts
export type StaticAnalysisMode = "off" | "baseline" | "strict";
export interface StaticAnalysisSelection {
  /** Resource-scoped setting value, or the product default when unset. */
  readonly configured: StaticAnalysisMode;
  /** What the server is actually running, once a client has reported. */
  readonly effective: StaticAnalysisMode | "unknown";
}
/** Capabilities the effective mode admits; the source of every "unavailable because" message. */
export type FusionCapability =
  | "columnLineage" | "columnDefinition" | "typeDiagnostics" | "selectStarHover" | "columnRename";
export function capabilitiesFor(mode: StaticAnalysisMode): ReadonlySet<FusionCapability>;
```

Contract: the setting is resource-scoped so a Declared Project can differ from its neighbor; the selection produces the client's mode argument; a change to the configured mode restarts that project's client rather than mutating a running one; and a capability Fusion withholds is surfaced in the status bar and output channel, never as a notification. Effective mode starts and remains `unknown` until the running server provides positive evidence. Do not call `capabilitiesFor` while effective mode is unknown, and do not advertise a `strict`-only capability from the configured mode alone. A capability absent because of a known effective mode reads as explained-unavailable, not as missing or broken. The extension performs, prompts for, and stores no login.

Verify: unit tests over the selection for each configured mode, the initial unknown effective mode, the rule that unknown enables no `strict`-only capability, and the restart-on-change rule; a capability-matrix test asserting the D5 table exactly. The live detection path is exercised by 5.3 and 5.4 once a client exists.

**5.1 — Executable resolution.** New `src/fusion/fusionExecutable.ts`.

```ts
export interface FusionExecutable {
  readonly path: string;         // absolute, verified executable
  readonly version: FusionVersion;
  readonly env: Record<string, string>;
}
export interface FusionExecutableResolver {
  /** Configured path first, then PATH lookup. Never invokes a tool manager. */
  resolve(scope: Uri): Promise<FusionExecutable | FusionVersionVerdict>;
}
```

Order: the resource-scoped configured path, then `which`-style `PATH` lookup. Support the standard variable substitutions (`${workspaceFolder}`, `${userHome}`, `${env:VAR}`) in the configured path. Inherit `process.env` unchanged; do not construct a Python environment. Do not read `mise.toml`, spawn `mise`, or special-case any tool manager — `mise-vscode` works by putting the shimmed binary on the extension host's `PATH`, so honoring `PATH` *is* the integration. Document that in `README.md` rather than coding for it.

Contract: the only thing the extension knows about tool managers is that they modify `PATH`.

Verify: unit tests for configured-path precedence, variable substitution, a non-executable configured path (blocking failure naming the path), and absence from `PATH` (blocking failure). Stop using `src/dbt_client/pythonEnvironment.ts` on this path, but do not delete the file yet — Phase 8 removes it.

**5.2 — Reverse-socket transport.** New `src/lsp/reverseSocketTransport.ts`. This is the highest-risk seam; the contract is precise because `--socket` means the server dials the client.

```ts
export interface ReverseSocketServer extends Disposable {
  /** Ephemeral port bound on 127.0.0.1 that the dbt process will connect back to. */
  readonly port: number;
  /** Resolves with the first accepted connection, rejects on timeout. */
  accept(timeoutMs: number): Promise<{ reader: NodeJS.ReadableStream; writer: NodeJS.WritableStream }>;
}
export function listenForServer(): Promise<ReverseSocketServer>;
```

Sequence: bind `127.0.0.1:0` and read the assigned port; spawn `dbt lsp --socket <port> ...`; await the inbound connection with a timeout; hand the socket to `vscode-languageclient` as a `StreamInfo` returned from a `ServerOptions` function; stop listening once connected. Bind to the loopback interface only. Handle the process exiting before connecting by rejecting with the process's captured stderr rather than a timeout, because a bad project configuration surfaces there.

Keep this file free of `vscode` imports apart from `Disposable` so the deferred stdio bridge can reuse it (decision 14).

Add `vscode-languageclient` as a dependency, pinned to a major compatible with `engines.vscode` and verified to load in Cursor (**S6**).

Verify: unit tests with a fake process that connects, never connects, exits immediately, and connects twice. Integration test against a real `dbt lsp` on `single-project` asserting a successful `initialize` whose result advertises `completionProvider`, `hoverProvider`, `definitionProvider`, `renameProvider`, `documentFormattingProvider`, `codeActionProvider`, and `semanticTokensProvider`, with no `diagnosticProvider` assertion.

**5.3 — The language client.** New `src/lsp/fusionLanguageClient.ts` and `src/lsp/fusionClientPool.ts`.

```ts
export interface FusionClientOptions {
  project: DeclaredProject;
  executable: FusionExecutable;
  lintEnabled: boolean;
  /** Namespaces workspace/executeCommand so two extensions can serve the same window. */
  commandPrefix: string;
}
export interface FusionClient extends Disposable {
  readonly project: DeclaredProject;
  readonly state: "starting" | "running" | "restarting" | "stopped" | "failed";
  readonly onDidChangeState: Event<FusionClient["state"]>;
  request<T>(command: FusionLspCommand, payload: unknown, token?: CancellationToken): Promise<T>;
  restart(): Promise<void>;
}
export interface FusionClientPool extends Disposable {
  /** One client per Declared Project, created and torn down with the registry. */
  get(project: DeclaredProject): FusionClient | undefined;
  readonly onDidChangeClients: Event<void>;
}
```

**Spawn contract:** Spawn cwd is `DeclaredProject.root.fsPath` exactly. Spawn environment includes `DBT_LSP_USE_TARGET_LSP=1`, overriding any inherited or configured value from the executable. This isolation prevents the LSP from corrupting manifest-driven paths.

**Configuration contract:** Implement `workspace/configuration` middleware that responds to the section `"dbt"` with `{lsp:{linter:{enabled:<lintEnabled>}}}` only, returning `null` for all other sections. Do not forward host settings that Fusion may not understand.

Arguments assembled per project: `lsp`, `--socket <port>`, `--project-dir <root>`, `--profiles-dir` when configured, `--target` when configured, `--lint-enabled <bool>`, `--static-analysis` from step 5.0's selection, `--no-version-check`, `--log-level` from the trace setting. `documentSelector` is scoped to the project root via a `RelativePattern`, so in a multi-root window each client sees only its own files — this is what prevents two clients from both answering for one document (**S3**).

`--command-prefix` is mandatory, not optional: the official dbt Labs extension registers the same bare `dbt.*` command names, and an unprefixed client in the same window collides (**S5**). Use the extension's own namespace as the prefix and record the resolved names in one place:

```ts
export const FUSION_LSP_COMMANDS = {
  listNodes: "dbt.listNodes",
  getCurrentNode: "dbt.getCurrentNode",
  compileFile: "dbt.compileFile",
  compileLsp: "dbt.compileLsp",
  clearTarget: "dbt.clearTarget",
  getProjectInfo: "dbt.getProjectInfo",
  show: "dbt.show",
} as const;
```

`request` applies the prefix. `dbt.previewCte` is a client command emitted bare by server code lenses, not an execute command; middleware rewrites it to a fork-owned command.

**Compile semantics:** Do not bootstrap `compileLsp` or `clearTarget` at startup. First `didOpen` on a file automatically triggers compile; both commands are explicit user-invoked operations only.

Lifecycle: restart with bounded exponential backoff on unexpected exit, cap the attempts, and on reaching the cap move to `failed` and log — do not notify. Dispose clients on project unregistration, workspace folder removal, configuration change affecting the executable or lint setting, and extension deactivation. Await process exit during disposal and escalate to `SIGKILL` after a grace period, so a window reload does not leak a server (**S4**).

Verify: unit tests for argument assembly, prefix application, backoff and cap, and disposal ordering. Integration tests: a `multi-root` window starts exactly two processes; deleting a project's `dbt_project.yml` stops exactly one; killing a server externally triggers exactly one restart; window teardown leaves no `dbt lsp` process (assert by PID list before and after).

**5.4 — Status and output.** New `src/lsp/fusionStatus.ts`. One status bar item reflects the Project Context's client state and effective static-analysis mode from step 5.0, including `unknown`; one output channel per project retains server logs. `vscode-languageclient` handles standard work-done progress. Replace `src/statusbar/versionStatusBar.ts` and `targetStatusBar.ts`; delete `src/statusbar/deferToProductionStatusBar.ts` if defer moves into the LSP path in Phase 7.

Contract: this is where decision 9 is enforced. Startup, parse, restart, and failure are all status-and-output. Add a unit test that activates the extension against the fixtures with `window.showInformationMessage`, `showWarningMessage`, and `showErrorMessage` spied, asserting zero calls. Keep that test permanently as the notification-policy guard.

Verify: the spy test is green and CI-enforced.

**5.5 — Diagnostics policy.** Pass standard Fusion diagnostics through unchanged. S1 observed neither dependency diagnostics nor harmful noise, so filtering and synthetic project blockers would be speculative. Add middleware only when a production-shaped regression demonstrates a concrete dependency-diagnostic failure.

Verify: no diagnostic middleware or second diagnostic store; a genuine root-project error reaches Problems once the loaded editor-flow test produces diagnostics.

**5.6 — Delete the language providers.** Delete each inherited provider with the production-shaped integration test for its replacement in the same implementation PR. Delete `src/autocompletion_provider/`, `src/definition_provider/`, `src/hover_provider/`, and `src/document_formatting_edit_provider/` after their completion, definition, hover, formatting, and code-action flows pass. Delete `src/validation_provider/`, `dbtPowerUser.validateSql`, and `src/commands/validateSql.ts` only with a green broken-model diagnostic test. Remove `dbt.sqlFmtPath` and `dbt.sqlFmtAdditionalParams`. In `src/code_lens_provider/`, keep `cteCodeLensProvider.ts`, `virtualSqlCodeLensProvider.ts`, and `documentationCodeLensProvider.ts`; the fate of `sourceModelCreationCodeLensProvider.ts` follows model generation in Phase 7.

Do not contribute a `documentSelector`-level formatter default and do not set `editor.formatOnSave`. Expose LSP formatting and code actions and let the repository or user decide (decision 7).

Verify: integration tests on `single-project` that completion inside `ref('` returns the fixture's models; hover on a dotted `package.macro` returns documentation (closing characterization case 1 through the LSP rather than a patch); go-to-definition on a `ref()` opens the model; rename across files works; formatting returns an edit; a broken `ref()` yields a diagnostic; and `source.fixAll.dbtLintFix` is offered on a lint violation.

**Release alpha.3** (`0.3.0-alpha.0`) follows the green 5.5 and 5.6 implementation tests. It is the first release that delivers the ADR 0002 thesis. Install in the consumer alongside the manifest-driven panels and use it for daily editing.

---

### Phase 6 — Switch the metadata producer → **beta.1**

Goal: execute the Section 2.6 reframing. Panels keep their contract; the manifest parse loop stops being the producer.

**6.0 — Publication epoch.** Add client-owned publication metadata to the existing event before the producer moves. `ManifestCacheProjectAddedEvent` carries a monotonically increasing `publicationEpoch`, a producer identity, and an optional producer revision token when one exists. The current manifest producer advances the counter only when it handles `MANIFEST_PARSED` and publishes a complete projection; watchers never mutate the counter directly. A counter keyed by Declared Project root survives `DBTProject` replacement within the extension session. Consumers remain unchanged.

The publication epoch is internal architecture, not product vocabulary. It marks one client publication and makes no claim about server generations or filesystem revisions. The manifest producer has no separate restart event; the LSP producer will advance on restart when it is introduced in 6.2.

Verify: the captured `MANIFEST_PARSED` handler publishes successive epochs and the current manifest producer identity, while source-file events do not advance the counter. No consumer file changes.

**6.1 — Introduce the port.** New `src/metadata/projectMetadataSource.ts`.

```ts
/** Produces exactly the event every panel, tree view, and lens already consumes. */
export interface ProjectMetadataSource extends Disposable {
  readonly project: DeclaredProject;
  readonly onDidChangeMetadata: Event<ManifestCacheProjectAddedEvent>;
  /** Latest snapshot, or undefined before the first successful build. */
  current(): ManifestCacheProjectAddedEvent | undefined;
  refresh(): Promise<void>;
}
```

Add `src/metadata/manifestMetadataSource.ts` as a thin adapter over today's `DBTProject.rebuildManifest()` and the adapter's `MANIFEST_PARSED` publication, with no behavior change, and route `src/dbt_client/dbtProjectContainer.ts` through the port.

Verify: the Phase 2 metadata snapshot test passes through the port unchanged. No consumer file changes in this step — if one does, the boundary is wrong; stop and reconsider.

**6.2 — LSP-backed implementation.** New `src/metadata/lspMetadataSource.ts`, built on `dbt.getProjectInfo` for project-level facts (name, target, paths, adapter), `dbt.listNodes` for the node set and graph edges, and `dbt.getCurrentNode` for column detail, refreshing on the client's parse-complete signal rather than on a timer or file watcher. Gated on **S2**'s payload contract for exactly these operations; the implementation cannot be specified without it. Where a map entry has no LSP source, read the Fusion artifact under the project's target path through the sanctioned capability-gap path of Section 2.8, with validated reads, and record the gap in a single table in `docs/refactor/lsp-metadata-gaps.md` — one row per field, with the command or artifact that supplies it. That table is the evidence for "artifacts only where the LSP lacks data" and the checklist for revisiting when Fusion adds coverage. Do not drop a retained feature rather than read an artifact; the protocol inventory decides which applies.

The LSP metadata source advances the publication epoch on successful publication and client restart. Its request wrapper captures the current epoch and, for document-scoped requests, the URI and document version before dispatch. Responses are accepted only on exact epoch equality and exact captured document-version equality; project-scoped requests require no document version. `RequestCancelled` and `ContentModified` are ordinary control flow and never reach the user. Add no request deduplication or persisted timing store. Do not debounce document synchronization; the client already sends incremental `didChange`. Refresh derived panels on save, not on keystroke.

Verify: the same Phase 2 snapshot assertions, now against the LSP source on the same fixture; advance-on-restart, stale-epoch discard, document-version discard, and project-scoped acceptance at the real request seam. Differences are either a bug to fix or a documented gap; nothing in between.

**6.3 — Flip.** Bind `ProjectMetadataSource` to the LSP implementation and delete `src/metadata/manifestMetadataSource.ts` with the `DBTProject.rebuildManifest` path that fed it, including its debounce, diagnostics collection, and `dbt parse` invocation. The parsers and the ambient target watcher are private to `DBTProjectIntegrationAdapter` and cannot be deleted here; they go when the adapter is retired at 7.1, which is the next step. Remove `dbt.disableDepthsCalculation` and `src/hover_provider/depthDecorationProvider.ts` if depth is not available from `dbt.listNodes`.

Contract: after this step no code this repository owns reads `manifest.json` to build project state.

Verify: `just check` green; full integration suite green; a model edit updates lineage and trees without a `dbt parse` subprocess (assert no `dbt parse` spawn during an edit).

**Release beta.1** (`0.4.0-beta.0`). No parallel semantic model remains.

---

### Phase 7 — Rebase commands and panels onto Fusion → **beta.2**

Goal: every retained capability in decision 11 works through Fusion and the LSP.

**7.1 — Retire the external project-integration adapter.** This is the ordering constraint from Section 2.3, and it discharges four things at once. Run **S7** first: it establishes whether the server writes artifacts and what rate the ambient watcher actually experiences, which is the evidence for how the removal is described and for whether anything needs escalating rather than sequencing.

Replace `DBTProjectIntegrationAdapter` with a local composition in `src/dbt_client/fusionProjectIntegration.ts` that constructs the published Fusion integration directly and exposes only the operations this product retains — dropping `validateSql`, `validateSQLDryRun`, `performDatapilotHealthcheck`, `fetchSqlglotSchema`, `validateWhetherSqlHasColumns`, `getPythonBridgeStatus`, and `generateDocs`, which Fusion does not support. Rewire `src/dbt_client/dbtProject.ts` and the factory in `src/inversify.config.ts` onto it. Metadata arrives through the port from step 6.3, so the adapter's parser wiring has no remaining consumer.

What this removes, and what it therefore unblocks: the adapter's mandatory Core, Cloud, and Core-command factory parameters, which is the only thing keeping Cloud constructible and is the real blocker Phase 8 was waiting on; the adapter's private ambient `fs.watch` over the target directory, which is the one prohibited artifact path in Section 2.8 and is not removable any other way; and the `PythonDBTCommandExecutionStrategy` path, leaving `CLIDBTCommandExecutionStrategy` taking the resolved `FusionExecutable`. Justify the watcher removal as eliminating an ambient stale-and-refresh path, not as proof that artifact reading is unsafe.

Verify: `just check` green; `grep -rn "DBTProjectIntegrationAdapter" src` empty outside deleted tests; no `fs.watch` or `FileSystemWatcher` over any project's target directory; compile, run, build, and test integration tests still pass.

**7.2 — Compile and preview.** Route `compileCurrentModel`, `sqlPreview`, `showCompiledSQL`, and `showRunSQL` through `dbt.compileFile` and `dbt.compileLsp`, falling back to `dbt compile` only where the LSP cannot serve the request. Keep `src/content_provider/sqlPreviewContentProvider.ts`.

Verify: integration tests asserting a compiled result for a model with a `ref()` and a macro, and that cancellation via the progress token actually cancels.

**7.3 — Run, build, test, clean, deps.** Keep the `DBTCommand` and queue machinery, which is already CLI-shaped, and `src/commands/runModel.ts`. Retain `runCurrentModel`, `buildCurrentModel` and its three graph-operator variants, `buildCurrentProject`, `testCurrentModel`, `runTest`, `runChildrenModels`, `runParentModels`, `cleanCurrentProject`, and `printEnvVars`; delete `generateDBTDocs`, since Fusion does not generate docs.

Verify: integration tests asserting argument construction for each command and that output reaches the terminal.

**7.4 — Query results, CTE preview, profiler, charting.** Route `executeSQL` through `dbt.show` when **S2** confirms it, else `dbt show --inline --output json`. Keep `src/webview_provider/queryResultPanel.ts` and `webview_panels/src/modules/queryPanel/`, including `@finos/perspective` and the charting path. Keep `src/code_lens_provider/cteCodeLensProvider.ts` and route it through `dbt.previewCte` when confirmed. Retain `dbt.queryLimit`, `dbt.queryScale`, `dbt.queryTemplate`, and `dbt.unquotedCaseInsensitiveIdentifierRegex`.

Note from the current Fusion code path: the JSON preview yields no column types, so every column arrives as `string`. Either recover types from `dbt.show` (check in **S2**) or make the panel's type display honestly absent rather than wrong.

Section 2.8 governs the data path here: submitted SQL stays deterministic so Snowflake's own reuse remains reachable, rows live in memory until the tab closes, and no result cache is built. Gated on **S9** for what Fusion actually exposes — the query id, cancellation of an in-flight preview, and `QUERY_TAG`. Where a query id is available, treat it as a transient join key that is displayed or discarded, surface the phase breakdown, and present a statement or queue timeout as a normal terminal state rather than an error. A cold warehouse resume shows up as provisioning queue time and is not the extension's latency.

Verify: integration tests executing a query against the fixture's warehouse target if one is configured, otherwise unit tests over recorded `dbt show` JSON. Assert the row limit is applied and cancellation kills the query.

**7.5 — Model and column lineage.** Rebuild `src/services/dbtLineageService.ts`, `src/webview_provider/newLineagePanel.ts`, and `src/webview_provider/modelGraphViewPanel.ts` on `dbt.listNodes` (graph, materialization, access, resource type) and `dbt.getCurrentNode` (columns, `is_primary_key`, `parents`, `transformation_type`). Column lineage becomes a Local Capability — it was an Altimate-gated feature upstream and is now served by Fusion. Surface `compilation_failed`, `lineage_query_failed`, and `models_count_is_estimate` in the panel rather than failing silently. Keep `lineage_panel/` and `webview_panels/src/modules/lineage/`; retain `dbt.lineage.defaultExpansion`, `dbt.lineage.showNonSelectEdges`, and `dbt.lineage.showSelectEdges`; remove `dbt.enableNewLineagePanel` by keeping only the new panel.

Verify: integration tests asserting model lineage on a three-level fixture chain and column lineage on a model whose column derives from two upstream columns, plus that the panel follows Project Context in `multi-root`.

**7.6 — Model trees and documentation editor.** Keep `src/treeview_provider/modelTreeviewProvider.ts` on the metadata port. Keep `src/webview_provider/docsEditPanel.ts`, `webview_panels/src/modules/documentationEditor/`, and the `generateSchemaYML`, `goToDocumentationEditor`, and `viewInDocEditor` commands, backed by the local half of `src/services/docGenService.ts` split in Phase 3 step 3.3 — scaffolding from schema, never generation from a model. Retain `dbt.prefixGenerateModel` and `dbt.fileNameTemplateGenerateModel`.

Verify: integration test writing a schema YAML for a fixture model and asserting the file round-trips through the editor.

**7.7 — Defer.** Rebase `src/services/deferToProdService.ts` and `applyDeferConfig` onto Fusion's `--defer`, `--state`, and `--favor-state`. Remove anything that fetches state from a hosted service; defer resolves against a local state directory only. Retain `dbt.deferConfigPerProject` in the new namespace. If Fusion's local defer cannot support the retained shape, cut the feature and record it in the ADR rather than shipping a half-working one.

Verify: integration test running a model with defer pointed at a fixture state directory.

**Release beta.2** (`0.5.0-beta.0`). Feature-complete against decision 11.

---

### Phase 8 — Delete the remaining old paths → **beta.3**

Goal: nothing Python, hosted, or multi-integration remains. Every step here should be a pure deletion that compiles.

**8.1 — dbt Core and dbt Cloud.** Available only after 7.1, which removes the last requirement for a constructible Cloud factory. The Core and Cloud integration classes live in `@altimateai/dbt-integration`, so this is deleting construction rather than files: remove the Core, Cloud, and Core-command bindings, factories, imports, and detection wiring from `src/inversify.config.ts`, and the tests that exercise them. Sweep `src` for remaining Cloud- and Core-shaped code rather than assuming the container was the whole of it. Remove `dbt.dbtCustomRunnerImport` and `dbt.installDepsOnProjectInitialization` if initialization no longer runs `deps`.

Verify: `just check` green; no Core or Cloud symbol is imported anywhere in `src`.

**8.2 — The Python bridge and payload.** Delete `dbt_core_integration.py`, `dbt_cloud_integration.py`, `altimate_packages/`, `src/dbt_client/pythonEnvironment.ts`, `src/dbt_client/runtimePythonEnvironmentProvider.ts`, the bridge creation and teardown on the execution infrastructure, and the `python-bridge` dependency. Delete the Python asset copy plugin in `rsbuild.config.ts` with them — the payload is runtime-required until 7.1 removes its callers, so it must not be deleted earlier. Remove the `ms-python.python` extension dependency and the Python launch configuration from `.vscode/launch.json`.

Verify: the unpacked VSIX contains no `.py` file; the extension activates with no Python interpreter selected.

**8.3 — Altimate and hosted remnants.** Delete `src/altimate.ts`, `src/services/sharedStateService.ts` if now unused, `src/test/suite/altimate.test.ts`, and the `dbt.altimateAiKey`, `dbt.altimateInstanceName`, and `dbt.altimateUrl` settings. Remove `NoCredentialsError` handling and `handlePreviewFeatures` from the command queue. Drop `node-fetch` and `node-abort-controller`.

Contract: no `SecretStorage` use, no credential prompt, no authentication code path anywhere. Add a test asserting `context.secrets` is never touched.

**8.4 — Prune what the hosted removals orphaned in the webview.** Steps 3.8 through 3.15 already removed the vendored bundle, the wizard surfaces, the unreferenced assets, and their dependencies; this step removes only what Phase 7 and steps 8.1 through 8.3 newly orphaned, with their routes. Keep Perspective, whose migration is v2 and gated on a spike; keep the lineage stack and the Tailwind generation, both of which leave only under D8's contract. Drop `webview_panels/` from the `rumdl.toml` exclude list if any Markdown survives there.

Verify: `just package` succeeds; record the VSIX size before and after in the commit message as the concrete measure of what Phases 3 and 8 removed.

**8.5 — Walkthroughs, quick picks, and dead contributions.** Rewrite `src/commands/walkthroughCommands.ts` and the `walkthroughs` contribution for the local Fusion setup story; remove the setup-wizard paths that installed dbt or switched integrations. Prune `src/quickpick/` to what remains. Audit every remaining entry in `contributes.commands`, `menus`, `submenus`, `views`, `viewsContainers`, and `keybindings` against the implemented set.

Verify: a test asserting every `contributes.commands` entry has a registration in `src` and every registration has a contribution — no orphans in either direction. Keep it permanently; it is the cheapest guard against contribution drift.

**Release beta.3** (`0.6.0-beta.0`).

---

### Phase 9 — Namespace, distribution, and docs → **1.0.0**

**9.1 — Settings and command namespace.** Rename every setting to `fusionPowerUser.*` and every command to `fusionPowerUser.*` in one PR, with no fallback reads of `dbt.*` and no deprecation aliases (decision 13). Separate contribution metadata, runtime call sites, tests, and migration documentation into focused revisions. Set `scope` correctly per property: `resource` for project, executable, lint, and enablement settings so folder values work; `window` only where genuinely window-wide. Write `docs/settings-migration.md` with the full mapping, including the settings the consumer actually sets:

| Old                                                                                                                                                                                                                          | New                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `dbt.enabled`                                                                                                                                                                                                                | `fusionPowerUser.enabled`                                                                   |
| `dbt.allowListFolders`                                                                                                                                                                                                       | `fusionPowerUser.projects`                                                                  |
| `dbt.dbtIntegration`                                                                                                                                                                                                         | removed — Fusion only                                                                       |
| `dbt.dbtPythonPathOverride`                                                                                                                                                                                                  | removed — see `fusionPowerUser.dbtPath`                                                     |
| `dbt.lineage.defaultExpansion`                                                                                                                                                                                               | `fusionPowerUser.lineage.defaultExpansion`                                                  |
| `dbt.lineage.showSelectEdges` / `showNonSelectEdges`                                                                                                                                                                         | `fusionPowerUser.lineage.showSelectEdges` / `showNonSelectEdges`                            |
| `dbt.perspectiveTheme`                                                                                                                                                                                                       | `fusionPowerUser.queryResults.theme`                                                        |
| `dbt.queryLimit` / `queryScale` / `queryTemplate`                                                                                                                                                                            | `fusionPowerUser.query.limit` / `scale` / `template`                                        |
| `dbt.prefixGenerateModel` / `fileNameTemplateGenerateModel`                                                                                                                                                                  | `fusionPowerUser.generateModel.prefix` / `fileNameTemplate`                                 |
| `dbt.deferConfigPerProject`                                                                                                                                                                                                  | `fusionPowerUser.defer.perProject`                                                          |
| `dbt.runModelCommandAdditionalParams` / `buildModelCommandAdditionalParams` / `testModelCommandAdditionalParams`                                                                                                             | `fusionPowerUser.run.additionalParams` / `build.additionalParams` / `test.additionalParams` |
| `dbt.unquotedCaseInsensitiveIdentifierRegex`                                                                                                                                                                                 | `fusionPowerUser.unquotedCaseInsensitiveIdentifierRegex`                                    |
| `dbt.sqlFmtPath` / `sqlFmtAdditionalParams` / `disableDepthsCalculation` / `enableNewLineagePanel` / `installDepsOnProjectInitialization`                                                                                    | removed                                                                                     |
| `dbt.altimate*`, `dbt.mcp*`, `dbt.enableCollaboration`, `dbt.enableNotebooks`, `dbt.disableQueryHistory`, `dbt.conversationsPollingInterval`, `dbt.enableMcpDataSourceQueryTools`, `dbt.dbtCustomRunnerImport`, `altimate.*` | removed                                                                                     |
| —                                                                                                                                                                                                                            | `fusionPowerUser.dbtPath` (new)                                                             |
| —                                                                                                                                                                                                                            | `fusionPowerUser.lint.enabled` (new, default `true`)                                        |
| —                                                                                                                                                                                                                            | `fusionPowerUser.staticAnalysis` (new, from step 5.0, resource-scoped)                      |
| —                                                                                                                                                                                                                            | `fusionPowerUser.profilesDir`, `fusionPowerUser.target` (new)                               |
| —                                                                                                                                                                                                                            | `fusionPowerUser.trace.server` (new)                                                        |

Verify: the orphan test from step 8.5; a test asserting no `contributes.configuration` key begins with `dbt.` and no `getConfiguration("dbt")` call remains in `src`.

**9.2 — Documentation.** Extend `CONTEXT.md` with any term Phases 4 through 7 introduced (candidates: **Fusion Client**, **Project Metadata Source**). Write `docs/architecture.md` for the *why* per the prose rules — activation, Declared Projects, the client pool, the metadata port, the panels — and `docs/lsp-metadata-gaps.md` from step 6.2. `AGENTS.md` and `CLAUDE.md` are already fork documents; update their command list and gates rather than rewriting them. Update `README.md` with install-from-release instructions, the macOS-only scope, the Fusion 2.0.5 minimum, and the `PATH`-based `mise-vscode` note from step 5.1.

**9.3 — VSIX smoke test.** Extend step 3.14's job rather than adding a second one: keep its pinned VS Code 1.128.x and Cursor acquisition strategy and its per-editor reporting, and add `scripts/smoke.sh` — POSIX `sh`, `usage:` on `--help`, `--force` — plus a `just smoke` recipe so the same assertions run locally. It packages the VSIX, then for each host: installs the VSIX, launches the editor on the `multi-root` fixture with a disposable user-data directory, and asserts activation, one successful LSP round trip, zero startup notifications, and no surviving `dbt lsp` process after exit. The per-editor result stays explicit so a Cursor-only failure is visible (**S6**).

Verify: `just smoke` green against both editors on macOS.

**9.4 — Release pipeline.** `ci.yml` already builds the VSIX and its SHA-256 on every push, so this step adds only the tag path: a `release.yml` that, on a tag, reuses the check-and-package job and creates a GitHub Release carrying the VSIX and checksum, marking alpha and beta tags as prereleases. Add `just release` for the local dry run. Document rollback in `docs/releasing.md`: consumers pin a version and checksum, so rollback is re-pinning the previous release; the installer refuses a checksum mismatch; a bad release is marked prerelease rather than deleted, so existing pins keep resolving.

Verify: a `0.6.1-beta.0` tag produces a release with a VSIX and a checksum file, and the checksum verifies.

**Release 1.0.0** once Phase 10 confirms the consumer works.

---

### Phase 10 — `finance-pipelines` adoption

Work in `/Users/daniel/projects/finance-pipelines`, following its conventions: POSIX `sh`, `usage:` on `--help`, `--force`, idempotent, verify by running the tool. That repository uses `gh stack` for stacked PRs per `.agents/skills/gh-stack/`.

**10.1 — Installer script.** Add `scripts/workspace/setup/install-fusion-power-user.sh`, modeled on `install-sigma.sh`. Contract: read the pinned version and SHA-256 from constants at the top of the script; skip when the pinned version is already installed and `--force` was not passed; download the VSIX from the GitHub Release to a `mktemp` path with a cleanup `trap`; verify the checksum and exit non-zero on mismatch *before* installing; for each of `code` and `cursor` present on `PATH`, uninstall `innoverio.vscode-dbt-power-user` if present and install the VSIX; print the installed version per editor; exit 0 when neither CLI exists, with a message.

**10.2 — Wire into setup and tests.** Call the script from `scripts/workspace/setup/justfile`'s `setup` recipe, passing `--force` through as the existing installers do. Add `"install-fusion-power-user.sh"` to the parametrized list in `tests/test_setup_scripts.py`. Add a test asserting the script fails on a checksum mismatch.

Verify: `just setup` installs into both editors; `just test` green; `just check` green.

**10.3 — Settings migration.** Apply the step 9.1 mapping to `finance-pipelines.code-workspace`, `.vscode/settings.json`, `transformation/dbt/finance_general/.vscode/settings.json`, and `transformation/dbt/finance_sox/.vscode/settings.json`. Concretely: `dbt.enabled` becomes `fusionPowerUser.enabled` (true in the multi-root window, false in the git-root folder); the folder-level `dbt.allowListFolders: ["."]` becomes `fusionPowerUser.projects: ["."]`, and the window-level three-entry list becomes `fusionPowerUser.projects` with the same relative paths; `dbt.dbtIntegration` and `dbt.dbtPythonPathOverride` are deleted; every `altimate.*` key and the collaboration, notebook, query history, and changelog keys are deleted. Keep `[jinja-sql]` pointing `editor.defaultFormatter` at sqlfluff with `formatOnSave: false` — decision 7 leaves that choice to the repository, and this repository has already made it. Update the comments, which currently explain upstream workarounds that no longer exist.

Note for the executor: `local_packages` is in the allow list today because upstream needed it there. Under ADR 0003 it is not a dbt project, so drop it and confirm that macros in `local_packages` still resolve — they should, because each dbt project parses its own packages. If they do not, that is a genuine finding about the Declared Project model and belongs back in Phase 4, not papered over with a third declared project.

Verify: open the multi-root workspace; exactly two `dbt lsp` processes run; completion, hover on a dotted `temporalize.reconcile`-style macro, go-to-definition, lineage, and compile all work in both dbt folders; opening a file in `finance_pipelines` or `repo` raises no notification; `cursor .` at the git root starts nothing.

**10.4 — Delete the patch machinery.** Remove `scripts/patch_dbt_power_user_macro_hover.py` and the `power-user-patch` task from `transformation/dbt/finance_general/.vscode/tasks.json` and `transformation/dbt/finance_sox/.vscode/tasks.json`. Remove `innoverio.vscode-dbt-power-user` from `extensions.recommendations` in `finance-pipelines.code-workspace`; a privately distributed VSIX cannot be recommended by identifier, so document the installer in `docs/setup.md` instead.

Contract: deleting this script is the acceptance signal for the whole refactor. Do not delete it until every one of its seven cases is verified green through the fork in step 10.3.

Verify: `just check` green; a fresh `just setup` on a clean checkout produces a working editor with no patching step.

## 4. The v2 north-star horizon

Phases 0 through 10 are v1: an incremental refactor that may preserve inherited structure where doing so keeps the sequence landable. v2 is the evidence-backed rip-and-replace work that does not fit v1 without either blocking it or being redone. It is scheduled here rather than omitted, and nothing from it is smuggled into a v1 step. The target is the best architecture for the hosts this product actually declares — VS Code and Cursor at Extensions API 1.128, Chromium 148 in the webview. Backward compatibility with the inherited approach, with upstream, or with older hosts is not a consideration.

Prerequisites for the whole horizon: **v1 complete through Phase 10 and the 1.0.0 release**, so the namespace, distribution, and consumer adoption are settled before the UI is rebuilt under them; step 3.13's recorded baseline, so every claim has a control; and step 3.14's pinned-host smoke, so a host regression is visible. Starting earlier would rewrite panels while their settings, command names, and installer are still moving.

Steps v2.1 through v2.4 are strictly serial. Each is gated on the measure named with it.

**v2.1 — Contracts and the panel seam.** The structural work, with the incumbent runtime left in place: a shared message contract both bundles import, a typed `LineageData` payload, one Vite entry per panel, and `PanelHost` on the extension side. Panels keep their current React implementations behind the new entries — **this step is not a rewrite**, and running it first is what makes v2.2's arms comparable and v1's deletions measurable per entry.

*The contract package.* Two bundles cannot share a module through a relative path across package boundaries, so the contract needs a real package. Create `packages/webview-contract/` — package name `@fusion-power-user/webview-contract` — holding `package.json`, `tsconfig.json`, `src/index.ts`, and its tests, published to nothing and consumed only inside this repository:

```ts
// One discriminated union per direction, exhaustive, no string constants outside it.
export type HostMessage = { kind: "lineage/data"; payload: LineageData } | /* … */;
export type PanelMessage = { kind: "panel/ready" } | { kind: "url/open"; url: string } | /* … */;
/** Hand-written narrowing over the union's discriminant. No schema library. */
export function isPanelMessage(value: unknown): value is PanelMessage;
export function isHostMessage(value: unknown): value is HostMessage;
```

Contract: the package has **zero runtime dependencies**. Validators are hand-written type guards over the discriminant, which is what a closed union of editor messages needs; introducing Zod, Valibot, or any validator library requires evidence that the guards have become unmaintainable, and the extension-host bundle size is the argument against adding one speculatively. TypeScript is its only devDependency. Nothing in the package imports `vscode` or any DOM type, because both bundles consume it.

*Workspace wiring.* The root package becomes the npm workspace owner:

- `package.json` — add `"workspaces": ["packages/*", "webview_panels"]` and depend on `@fusion-power-user/webview-contract`; drop the `check:lockfile:webviews` script, which no longer has a second lockfile to check.
- `webview_panels/package.json` — depend on `@fusion-power-user/webview-contract`; delete `webview_panels/package-lock.json`, since the root lockfile now resolves both trees.
- `packages/webview-contract/package.json` — private, ESM, `exports` pointing at built `dist` with its `.d.ts`, and `build` plus `watch` scripts running `tsc -b` and `tsc -b --watch`.
- `tsconfig.json` and `packages/webview-contract/tsconfig.json` — the package is `composite` with `declaration`, and the root adds a `references` entry for it. `tsc -p ./` does not build referenced projects, so the root `compile` script becomes `tsc -b`. The package ships built output rather than source because the host's `rootDir` is `src` and TypeScript will not emit for a source file outside it.
- `rsbuild.config.ts` — no change beyond *not* adding the package to the explicit `config.externals` allowlist; it must be bundled into the host.
- `webview_panels/vite.config.ts` — the workspace package is symlinked, so add it to `optimizeDeps.include` for the dev server; the production build bundles it without further configuration.

*Build order, from a clean install.* Exporting built `dist` means **every consumer path needs the contract built first**. Putting the prerequisite only in the root Just recipes would leave `npm run build`, `npm run dev`, and the webview recipes broken from a clean tree, so it goes at the lowest exposed entrypoint: **each public npm script is self-sufficient**, and composites call internal variants so one command never starts two contract watchers.

Split each consumer script into a public script that guarantees the contract and an internal `:app` script that assumes it. `concurrently` is a root devDependency, and a single hoisted workspace install puts it on the PATH of every workspace's scripts, which is what makes the webview scripts below possible.

| Entrypoint                       | Factoring                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root `build:contract`            | `npm run build --workspace @fusion-power-user/webview-contract`; `watch:contract` runs its `tsc -b --watch`                                                           |
| root `build`, `build:dev`        | `build:contract` then `build:app` / `build:dev:app`, which hold today's `rsbuild build` invocations                                                                   |
| root `watch:extension`           | `build:contract`, then `concurrently` over `watch:contract` and `watch:extension:app`                                                                                 |
| root `vscode:prepublish`         | `build:contract`, then the webview and host **`:app`** scripts, so `vsce` triggers exactly one contract build                                                         |
| webview `build`                  | `npm run build --prefix ../packages/webview-contract` then `build:app`; `--prefix` is directory-based and works from a nested workspace, where `--workspace` does not |
| webview `watch`, `dev`           | the same prebuild, then `concurrently` over the contract's watch and `watch:app` / `dev:app`                                                                          |
| `just webviews::build/watch/dev` | delegate to those public scripts unchanged, so they inherit the prerequisite                                                                                          |
| `just build`, `build-dev`        | `just build-contract`, then the webview and host `:app` scripts                                                                                                       |
| `just watch`                     | `just build-contract`, then one `concurrently` over `watch:contract`, the webview `watch:app`, and `watch:extension:app`                                              |
| `just compile`                   | unchanged once `compile` is `tsc -b`, which builds the referenced project                                                                                             |

Watch and dev must keep rebuilding on contract edits, not merely prebuild once — that is why every long-running path pairs the initial build with a contract watcher rather than just seeding `dist`.

Verify from a reset state each time: remove `node_modules`, `out`, `dist`, and `packages/webview-contract/dist`, run `just sync`, then run **one** public entrypoint and confirm it succeeds — `just compile`, `just build`, `just build-dev`, `just package`, `npm run build`, `npm run build:dev`, `npm run build --prefix webview_panels`, `just webviews::build`. For the nonterminating ones — `just watch`, `npm run watch:extension`, `npm run watch --prefix webview_panels`, `just webviews::watch`, `npm run dev --prefix webview_panels`, `just webviews::dev` — smoke each from reset: wait for the first successful build, touch `packages/webview-contract/src/index.ts`, confirm the consumer rebuilds, confirm only one contract watcher is running, then terminate. A path that works only because another command ran first is the defect this matrix exists to catch.

*Quality coverage.* The package participates in `just check` directly, not only through its consumers:

- `eslint.config.cjs` — extend the `files` glob beyond `src/**/*.ts` to cover `packages/*/src/**/*.ts` and the package's own config files; root `lint` and `lint:fix` scripts widen from `eslint src --ext ts` to include `packages`.
- `package.json` `format` and `check:format` — Prettier's glob already spans the repository for its file types; confirm it reaches `packages/` and is not excluded by `.prettierignore`.
- `jest.config.js` — add the package's `src` to `roots` and map the package name to its `src/index.ts` in `moduleNameMapper`, alongside the existing `@extension` entry, so contract tests run in the existing suite with no second runner and no build before `just test`.
- Type checking comes free from the project reference once `compile` is `tsc -b`.

*Single-install policy.* The root install becomes authoritative, which forces a real reconciliation rather than a concatenation: the two `allowScripts` policies disagree today — `@parcel/watcher` is denied at the root and allowed in `webview_panels`. Merge them into one root policy, re-reviewing every entry rather than taking the union, and delete the nested policy with the nested lockfile. Then run `just sync`, whose `npm ci --strict-allow-scripts` fails on any package whose script policy is unset, and `npm install-scripts prune` to drop entries no longer in the tree. `just update` and `just lint-lockfiles` each collapse to a single root invocation. CI calls `just sync`, `just check`, and `just package`, so no workflow file changes.

Verify: one `package-lock.json` at the root and none under `webview_panels`; `npm run check:lockfile` green; `just sync` clean on a fresh clone with no allow-script prompt or failure; the merged policy reviewed entry by entry in the PR.

*Packaging.* Add `packages/**` to `.vscodeignore`. The contract's source is already excluded by the existing `**/*.ts` rule, but its built `dist` is not, and it must not ship standalone — it is bundled into the host bundle by Rspack and into the panel bundles by Vite. Verify with `vsce ls`: no `packages/` entry of any kind, and the VSIX still contains the host and webview bundles.

*Migration order inside the PR, so there is no flag day.* Five revisions, ordered so that **no revision introduces source that is not compiled and tested by the revision that adds it**. The tooling comes first and the content second, because the reverse order would add package source that nothing builds or runs.

1. **Skeleton and wiring.** `packages/webview-contract/` with its `package.json`, `tsconfig.json`, and a minimal `src/index.ts` exporting nothing yet, plus the whole tooling surface above: workspaces, the merged install policy, the single lockfile, the build and watch factoring, the quality-coverage widening, and the `.vscodeignore` entry. The package is real, built, linted, type-checked, and packaged from this revision on, and no consumer imports it yet — which is exactly the state the clean-install matrix should be run against.
2. **The contract.** The discriminated unions, the guards, and the package's tests, which the widened Jest configuration already runs.
3. **Host validation.** Guard the host's existing message-handling sites, one panel host at a time, logging and dropping an unrecognized message rather than throwing.
4. **Panel entries.** Cut each panel's entry over behind `PanelHost` and replace that panel's ad-hoc command strings with the union as its entry lands.
5. **Cleanup.** Delete the duplicated `openUrl` / `openURL` pair, once both ends speak only the union.

Every revision compiles and its tests pass; the tip is the green unit.

*`PanelHost` and the entries.* One host-side HTML generator owning one CSP, one resource-root policy, and one inbound validator — the guard from the package — replacing the per-panel `getHtml` methods and the two CSPs that have already diverged. One Vite entry per panel replaces the single bundle, the runtime router, and `window.viewPath`.

Verify: the clean-install matrix above; `just check` and `just package` green with one lockfile; `npm ls @fusion-power-user/webview-contract` resolves from both the root and `webview_panels`; the contract's own lint, format, type, and test coverage runs inside `just check`; `vsce ls` shows no `packages/` entry; per-entry payload recorded against step 3.13's single-entry baseline; every inbound message passes a guard; one CSP generator remains; the existing panels behave as before.

**v2.2 — The comparative benchmark and the deferred decisions.** Nothing ships. With the contract and the entry seam in place, build each arm against the same three panels and the same payloads, and record **D6** the UI runtime, **D7** the lineage renderer, and the Perspective 5 migration's viability. Run the runtime comparison and the renderer benchmark **together**, because `@xyflow/react` couples them, and against v2.1's React baseline as the control. Measure per-entry eager bytes, in-webview first-contentful-paint, keyboard and screen-reader acceptance, and the code needed to drive the Perspective viewer and the selected renderer; publish every arm even when the incumbent wins. The renderer benchmark takes node, edge, and per-node column distributions from real Declared Projects, starting with `finance-pipelines`, and has column-level lineage in the harness from the first run. The Perspective spike runs in a throwaway Vite app under the real CSP: load a table from the current query-result payload shape, render the datagrid, render a chart, restore a saved configuration, and either port the custom datagrid plugin or demonstrate its feature another way; establish by removing each independently which of `script-src 'unsafe-eval'` and `worker-src blob:` the WASM runtime still needs.

**v2.3 — Build the selected lineage renderer** behind `LineageData` and its own entry, replacing the `CustomEvent` and monkey-patched helper the current component is driven by. Rollback boundary: keep the existing component reachable until the replacement passes v2.2's benchmark against real projects. This is the hard-to-reverse step of the horizon.

**v2.4 — Resolve the styling contract per D8.** With the replacement's requirements known, either delete the Tailwind toolchain and its configuration, generated globals, and selector guard together, or write a fresh Tailwind 4 configuration against the new contract with the hand-adapted Preflight retired into supported configuration. The `al-` generation is never migrated and generated output is never vendored. The guard stays green until this step and is deleted or replaced by it, never partially disabled. Bootstrap and `reactstrap` leave with it, since the scoped Preflight exists to protect them.

**v2.5 — Migrate Perspective** from `@finos/perspective` to `@perspective-dev/*` on v2.2's evidence, including the CSP narrowing it established. `@finos/perspective` is deprecated with an explicit upgrade instruction, and this migration is the only path that clears the high-severity `d3-color` advisory, which reaches the tree solely through `@finos/perspective-viewer-d3fc`. Confirm afterwards with `npm audit` that the replacement has not reintroduced it.

**v2.6 — Apply the runtime decision** across the three panels if it differs from the incumbent, then the token layer and state cleanup: one `tokens.css` mapping `--vscode-*` instead of an independent palette, with light, dark, and high-contrast in the acceptance checks; `getState`/`setState` implemented in every panel against the UI-only schemas Section 2.8 requires, and `retainContextWhenHidden` removed, measuring memory before and after. Each panel's schema is reviewed against that prohibition list before it ships. Ship the persistence change one release after v2.1 so a regression is attributable.

**v2.7 — Post-Phase-7 React candidates, only if the selected stack and its tests justify them.** React Compiler, `useEffectEvent`, and Fragment Refs each have real candidates in this codebase — a stale-identity CSV handler and incomplete dependency arrays in the Perspective viewer, shadow-DOM reach-through, and placeholder mount divs in the lineage widget. All three are behavioral changes, all three presuppose D6 selected React, and all three require the webview tests from step 3.13 plus the panel rewrites above to have settled. React Compiler additionally needs a measured render-performance problem, which no one has yet reported.

**v2.8 — Playwright over VS Code 1.128.x and Cursor**, one fixture differing only in executable path, reusing step 3.14's pinned acquisition strategy, with the webview frame traversal isolated in a single fixture that fails with a clear message. That traversal is an undocumented VS Code implementation detail reached through an experimental Playwright API; treat a break as expected maintenance, not a regression.

Measures for the horizon, each against step 3.13's recorded baseline rather than a chosen number: VSIX size and image share; eager bytes per panel entry; webview CSS bundle and owned stylesheet bytes; in-webview first-contentful-paint per panel; cold activation; distinct advisories in the webview tree, targeting zero; panels using `retainContextWhenHidden`, targeting zero; panels persisting through `getState`/`setState`, targeting all; hand-written CSPs, targeting one; unvalidated message commands, targeting zero.

Rollback boundaries: v2.1, v2.4, and v2.6 are structural changes and deletions with no persisted data, so they revert cleanly. v2.3 is the hard one and is gated on the benchmark. v2.5 is gated on the spike.

## 5. Risks, spikes, and checkpoints

### Spikes — do these before the step that depends on them

Rules that apply to every spike, as conditions of running rather than advice. Capture verbose protocol traces against **synthetic fixtures only**, never a real or production project: verbose tracing records document contents, hover payloads, and completion context. **Redact at capture time, not at review time** — persist method names, timings, sizes, and outcomes; strip document bodies, SQL text, and identifier values. Never retain query text or result rows. **A Snowflake query id is an identifier, not a metric**: hold it in memory as a join key for the duration of a single run, then discard it or replace it with a hash whose key is thrown away; no raw query id reaches a log, an artifact, or the harness. Anything that touches an account or a warehouse requires the operator's explicit per-run consent naming the account and the warehouse. Spike artifacts live in one declared directory outside any project's `target/`, are excluded from version control, and are deleted when the spike's decision is recorded.

Reconcile before running. **S2** and the `initialize` capability record in Section 2.4 already cover part of this ground; extend that record rather than re-capturing it.

**S1 — Dependency diagnostics. Complete.** The 2026-09-22 run was inconclusive: parse-clean control with null load probes and no push diagnostics. D3 therefore chooses pass-through rather than speculative filtering. Reopen only with a production-shaped regression.

**S2 — Custom command payloads, and the migration's payload contract.** Before Phase 5 step 5.3, and blocking step 6.2 and Phase 7. The command *names* are already known (Section 2.4). What is unknown is each command's argument and response schema, and whether `dbt.show`, `dbt.previewCte`, and `dbt.goToDefinition` are actually registered. Drive each of `dbt.getProjectInfo`, `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.show`, and `dbt.previewCte` over the socket against `single-project`, and record request and response JSON in `docs/refactor/lsp-commands.md`. Scope the trace to the flows the migration needs — open a model, request compiled SQL, request lineage, request node metadata — rather than attempting a complete method inventory. Confirm whether `dbt.show` returns column types, which decides step 7.4. Also confirm `--command-prefix` semantics: whether the prefix replaces or prepends the `dbt.` segment. Time-box one day. **This is the largest single unknown in the plan; if a retained feature has no command and no artifact behind it, surface that before Phase 7 rather than discovering it mid-phase.** No Fusion LSP method name belongs in a design before this record exists; the public engine source says nothing about the server, which is closed.

**S3 — Multi-root Project Context.** Before Phase 5 step 5.3. Confirm that a per-project `documentSelector` built from a `RelativePattern` actually prevents two clients from both answering for one document, and check the behavior for a file open in no workspace folder and for a `.sql` file inside a project's `target/`. Time-box two hours. The library record in `docs/refactor/s3-document-selector.md` is partial: protocol 3.18 and `vscode-languageclient` major 10 are required for relative document filters; a failed conversion drops the pattern and fails open to every matching language and scheme. Step 5.3 must use string URI bases and reject converted filters without a pattern. The live two-client, no-workspace-folder, overlapping-root, and `target/` cases remain unmeasured.

**S4 — Process lifecycle.** Before Phase 5 step 5.3. Measure resident memory and startup time for one `dbt lsp` on a Consumer Repository-sized project, then for two concurrently. Confirm whether the server exits on its own when the client socket closes or must be signalled, and whether a window reload leaves an orphan. Establish the `SIGTERM`-to-`SIGKILL` grace period empirically. Time-box half a day. Partial: `docs/refactor/s4-process-lifecycle.md` on the `single-project` fixture (pre-load handshake, Darwin arm64) — one process ~53 MiB and 89 ms to the `initialize` response; two concurrent ~106 MiB summed pre-load RSS and 120 ms max startup; idle socket close exits (n=3); idle `SIGTERM` in 3 ms (n=1). Post-load memory/startup, Consumer Repository scale, window reload, in-flight disposal, and an empirical `SIGTERM`-to-`SIGKILL` ceiling not measured; step 5.3's open lifecycle questions remain.

**S5 — Coexistence with the official dbt extension.** Before Phase 5 step 5.3. Install `dbtLabsInc.dbt` alongside a development build and check for collisions in `workspace/executeCommand` names, language configuration, `files.associations`, and duplicated diagnostics. This is not the same as the upstream Power User conflict in step 1.3: the official extension is a legitimate coexistence case for a user who also uses dbt Platform. Decide whether to coexist via `--command-prefix` or to add a second conflict guard. Time-box two hours. The static comparison in `docs/refactor/s5-coexistence.md` is partial: manifest command ids and injection grammars do not overlap, but both extensions declare `jinja-sql` and `source.sql.jinja`; distinct advertised LSP command ids avoid client-side command registration collisions. Duplicate diagnostics, TextMate behavior, and the guard decision still require a live side-by-side run.

**S6 — Cursor parity.** Before Phase 5 step 5.2. Confirm the chosen `vscode-languageclient` major loads in Cursor's extension host and that `engines.vscode` is satisfiable there, since Cursor tracks a VS Code version behind upstream. Confirm `cursor --install-extension` accepts a local VSIX path. A failure here changes the `vscode-languageclient` pin and the `engines.vscode` floor, so it must precede the dependency being added. Time-box two hours. `docs/refactor/s6-cursor-parity.md` discharges S6: Cursor 3.20.14 embeds API 1.128.0, the official extension-host runner loaded `vscode-languageclient` 10.1.1 with direct in-host assertions, and the isolated Cursor CLI accepted a local VSIX. Pin major 10 and keep `engines.vscode: ^1.128.0`.

**S7 — Target mutation and the ambient-watcher rate.** Before step 7.1, and the evidence that decides whether the ambient watcher needs escalation rather than retirement in sequence. Part one: snapshot size, `mtime_ns`, and hash of `target/manifest.json` and `target/compiled/**`, run a fixed editing session with no terminal commands, and re-snapshot on an interval, to learn whether the server writes artifacts at all. Part two measures what the extension actually experiences, which a tight reader loop does not: reproduce the real registration — non-recursive `fs.watch`, 300 ms trailing debounce, one read per settled burst — and drive it with genuine external commands at realistic spacing, counting settled-burst reads, parse failures, and skipped publications per command class and project size. Report a tight-loop number only if part one produced one, and label it **writer vulnerability**, not race rate; the two differ by orders of magnitude. This is also the natural place to observe whether duplicate extension-initiated work exists, which is what gates the deduplication layer step 6.2 defers. Time-box one day. The capture in `docs/refactor/s7-target-writes.md` is inconclusive: an unloaded, idle session with only before/after snapshots produced no target write to measure, so part two was not triggered. Step 7.1 still needs a loaded editing session with interval snapshots.

**S8 — Config-change behavior.** Before step 6.2 broadens its initial compile-complete and restart refresh triggers. With the server running, make a semantically neutral change to `dbt_project.yml`, then to `profiles.yml`, then rewrite `package-lock.yml` through `dbt deps`. After each, record whether the server reparses, restarts, errors, or does nothing, and how long until results are correct. Time-box half a day. `docs/refactor/s8-config-changes.md` is inconclusive: the live server registered `**/*`, and all three in-workspace stimuli were applied, but the project never finished loading and produced no observable within each bounded wait. Step 6.2 starts from observed producer completion and restart rather than claiming broader change coverage.

**S9 — Snowflake query identity and phases.** Before Phase 7 step 7.4. **Touches an account; requires explicit opt-in.** Run the same preview on a cold warehouse, a warm warehouse, an identical repeat for result reuse, and a repeat with reuse disabled; read the query id, compilation and execution times, and the queue columns from `INFORMATION_SCHEMA.QUERY_HISTORY`, not the account-usage view, which lags. Record whether the extension can obtain a query id at all, whether an in-flight preview can be cancelled, and whether a query tag can be set through Fusion. Output: per-phase distributions and two yes-or-no answers. Query-id handling follows the rules above. `docs/refactor/s9-query-phases.md` is partial: exact-repeat timings were measured, but cold provisioning was not proven and reuse-disabled was unavailable because each Fusion invocation used a different session. The CLI preview path exposed no query id, cancellation, or tag mechanism; LSP cancellation and tag paths remain unchecked. Step 7.4 remains open.

**S10 — Effective static-analysis mode. Complete for sequencing.** The rerun did not establish effective-mode differences. Launch `baseline`, retain effective mode `unknown`, verify provider replacements in their implementation PRs, and defer strict-dependent enhancements until positive runtime evidence.

### Risks, ranked by how likely they are to change the plan

1. **A retained feature has no LSP command and no artifact.** Most likely candidates: the CTE profiler's statistics, query-result column types, and defer against local state. Mitigation: **S2** before Phase 7. Response: cut the feature and record it, rather than reviving a Python path.
2. **Retiring `DBTProjectIntegrationAdapter` is larger than the container wiring suggests.** It is the manifest producer, the command facade, and the Cloud requirement in one object, and its full reach into `src/dbt_client/dbtProject.ts` has not been surveyed. Mitigation: 6.1 through 6.3 move metadata off it first, so 7.1 faces only the command surface. Response if it is still too large: split 7.1 by operation group, never by leaving the adapter constructed "temporarily" — every step after it is gated on its absence.
3. **Two `dbt lsp` processes on a large monorepo are too slow or too heavy.** Mitigation: **S4** measures it before the design is committed. Response: start clients lazily on first file open per project rather than at activation — a change localized to `FusionClientPool`, which is why the pool is a separate seam.
4. **The deferred webview decisions get made by default instead of by measurement.** D6, D7, and D8 are all easy to settle accidentally — by writing React into a v1 step, by picking a renderer to unblock a panel, or by deleting the Tailwind generator early. Mitigation: v1 touches none of the three. Response: if a v1 step appears to need one of them, the step is mis-scoped.
5. **`ManifestCacheProjectAddedEvent` turns out to be the wrong boundary** — for instance, the LSP cannot populate a field that three panels require. Mitigation: Phase 6 step 6.1's rule that no consumer file changes. If one must, stop: that is the signal the boundary is wrong, and it is far cheaper to learn at 6.1 than at 6.3.
6. **Cursor and VS Code diverge in extension-host behavior.** Mitigation: **S6** early, and a VSIX smoke test that reports per-editor results for the life of the project.
7. **Fusion licensing gates a retained capability.** Decision 4 forbids working around it. Response: detect the gate, surface Fusion's own message, and mark the capability unavailable. Never implement a bypass.
8. **Concurrent sessions overwrite each other's work in this repository.** This plan file was itself overwritten once during authoring. Mitigation: one implementation workspace is active at a time; each PR uses focused jj revisions; read-only review may overlap; and the next PR starts only after its parent is pushed, in a separate child workspace.

### Checkpoints — stop and confirm

**D1** and **D2** are resolved; Phase 0 and Phase 1.1 are complete.

- **Before Phase 5 step 5.0:** **D5** is decided: no login. Configuration supplies the launch argument; effective mode remains unknown without positive server evidence.
- **Before Phase 7:** the **S2** command inventory, with any retained feature that has no backing command named explicitly. This is the point where the comprehensive target either holds or must be amended.
- **Before Phase 8:** confirm beta.2 has been used against the real consumer repository long enough to trust it. Phase 8 is where the old paths stop being available as a fallback.
- **Before Phase 10 step 10.4:** all seven consumer characterization cases verified green through the fork.
- **Before v2 step v2.3:** **D6** and **D7** together, and the Perspective spike's verdict, all from v2.2. **D8** follows at v2.4 once the replacement's styling contract exists. None of the four may be settled by a v1 step.

### Hard-to-reverse steps

Phase 6 step 6.3 (flipping the metadata producer), Phase 7 step 7.1 (retiring the adapter), Phase 8 in its entirety, Phase 9 step 9.1 (the namespace rename), and v2 step v2.3 (the lineage renderer) are expensive to undo. Each of the v1 steps is preceded by a release, so the prior artifact remains installable and pinned in the consumer while the next one is validated; v2.3 is gated on its benchmark and keeps the existing component reachable until it passes. Do not batch any of them with another step.
