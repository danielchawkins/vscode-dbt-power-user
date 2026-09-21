# Fusion Power User: refactor plan

Land each step as a feature bookmark and a pull request against `main`. [`implementation-dispatch.md`](implementation-dispatch.md) is the execution layer: trunk, workspaces, overlap, and the two file-path corrections. This file remains the spec: contracts, file lists, verification, spikes, and Confirm gates. Remaining work is sequenced in [`remaining-implementation.md`](remaining-implementation.md).

## 1. Goal and scope

Turn this fork of `vscode-dbt-power-user` into **Fusion Power User** (`danielchawkins.fusion-power-user`): a local-only, MIT-licensed VS Code / Cursor extension for dbt Fusion projects, in which the native dbt Fusion language server owns all editor intelligence and no feature depends on a hosted service, an extension-specific account, telemetry, or a Python bridge.

In scope: product identity; the Declared Project model; a reverse-socket `LanguageClient` per Declared Project; replacing the manifest-driven parse loop and language providers with LSP-sourced metadata; rebasing compile / preview / run / build / test, query results, CTE preview and profiler, charting, model and column lineage, model trees, the local documentation editor, and local model generation and defer onto Fusion; removing dbt Core, dbt Cloud, Altimate hosted services, authentication, telemetry, AI, collaboration, MCP, and notebooks along with their dependencies; a new `fusionPowerUser.*` settings namespace; VSIX distribution via GitHub Releases; and adoption in the `finance-pipelines` consumer repository.

Explicitly out of scope: marketplace or OpenVSX publication; Windows and Linux support (macOS only for the first releases); a generic socket-to-stdio bridge; upstream compatibility or contributing changes back; any attempt to unlock Fusion capabilities that Fusion itself gates behind licensing or `dbt auth`; and the MkDocs site under `documentation/`, which is deleted rather than rewritten.

Executors: work the steps in order. Each step is one commit that compiles and has green tests. Where a step says **Confirm**, stop and get a human decision before proceeding. The verification command throughout is `just check`, plus `just package` where a step changes packaging.

## 2. Grounding

### 2.1 Recorded decisions this plan honors

- `CONTEXT.md` — the vocabulary is fixed. Use **Declared Project**, **Dependency Project**, **Project Context**, **Local Capability**, **Hosted Capability**, **Consumer Repository**. Do not introduce "allowed folder", "discovered project", "child project", "selected project", "premium feature", or "downstream repository". Extend `CONTEXT.md` when a step introduces a genuinely new concept.
- `docs/adr/0001-local-fusion-only-product.md` — independent local Fusion-only product; remove dbt Core, dbt Cloud, hosted Altimate services, auth, telemetry, AI, collaboration, MCP, notebooks.
- `docs/adr/0002-use-the-native-fusion-lsp.md` — one native `dbt lsp` per Declared Project owns completion, diagnostics, hover, navigation, references, rename, formatting, code actions, and semantic information. Panels call LSP commands first and read Fusion artifacts only where the protocol lacks data. The parallel manifest-driven language providers and parse loop are removed.
- `docs/adr/0003-scope-services-to-declared-projects.md` — auto-serve a workspace-folder root containing `dbt_project.yml`; explicit folder-scoped project paths handle nested layouts; one LSP process per Declared Project; no recursive discovery; a Dependency Project gets no independent editor service.
- `AGENTS.md` and `CLAUDE.md` in this repository are already fork documents pointing at `CONTEXT.md`, `docs/adr/`, and `docs/refactor/`. They state that the shipped extension never invokes mise or Just, and that PRs must pass `just check` and `just package`. Honor both. The upstream Altimate architecture guide they replaced is gone; do not reintroduce it.
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
12. Migration: small green commits — characterization tests, LSP behind an internal boundary, switch consumers, then delete old paths and dependencies. No big-bang rewrite.
13. Distribution: GitHub Release VSIX with checksum, pinned by the consumer. `finance-pipelines` setup installs it into Cursor and VS Code when each CLI exists. New `fusionPowerUser.*` namespace with a documented migration and no fallback reads of `dbt.*`.
14. macOS only initially. Defer a generic socket-to-stdio bridge but keep transport code reusable.
15. The full target is comprehensive. Sequence alpha and beta prereleases for testing; do not drop target features because the first alpha is small.

### 2.3 Verified facts about the current fork

Branch `fusion-lsp-client` is based on upstream `0.64.6`. No LSP code exists; `vscode-languageclient` is not a dependency. `src` is ~44k lines of TypeScript; `webview_panels/src` is ~19k lines of TypeScript and TSX. `package.json` contributes 66 commands and 33 configuration properties. The package identity is `danielchawkins.fusion-power-user` / `Fusion Power User` at `0.1.0-alpha.0`; command IDs and settings intentionally retain their upstream namespaces until Phase 9.

**The tooling baseline is green and must not be redone.** In place: `mise.toml` selecting Node 24 and current contributor CLIs with a committed lock; `scripts/workspace/setup/setup-environment.sh` bootstrapping mise and Just; root and webview Just files owning setup, build, format, lint, test, package, and jj workflows; package scripts exposing package-local operations and required lifecycle hooks; dprint and rumdl owning the 27 maintained Markdown files; and `just check` chaining compile, root and webview lint, code- and shell-format checks, ShellCheck, both npm lockfile validations, 637 unit tests, and Markdown checks. Root and webview dependencies install with `npm ci`. The single macOS CI job uses SHA-pinned actions, runs the same checks and package gate, emits a SHA-256 checksum, uploads the VSIX, and cancels superseded runs. Marketplace, OpenVSX, Slack, hosted Altimate dispatches, the upstream documentation site, and upstream contributor automations are deleted. Lefthook replaces Husky and lint-staged; `.agents/skills/` carries `configure-mise`, `justfile-expert`, `jujutsu`, and `write-skill`.

Load-bearing product structure the plan depends on:

- `src/extension.ts` → `src/dbtPowerUserExtension.ts` (`DBTPowerUserExtension.activate`) is the single activation path. It constructs fifteen collaborators through Inversify and calls `detectDBT()` then `initializeDBTProjects()`.
- `src/inversify.config.ts` holds every factory binding, including the three `switch (dbtIntegrationMode)` factories that select Core / Cloud / Fusion detection and integration.
- `src/manifest/dbtWorkspaceFolder.ts` implements recursive discovery: `workspace.findFiles` over `**/dbt_project.yml` with a hardcoded exclude, then an `allowListFolders` filter read **without** a folder URI, then `DBTProjectDetection.discoverProjects`. This is the code ADR 0003 replaces.
- `src/manifest/event/manifestCacheChangedEvent.ts` (`ManifestCacheProjectAddedEvent`) plus `src/domain.ts` (`NodeMetaMap`, `MacroMetaMap`, `SourceMetaMap`, `GraphMetaMap`, `TestMetaMap`, `DocMetaMap`, `ExposureMetaMap`, `MetricMetaMap`) is the metadata contract that every panel, tree view, lineage view, and code lens already consumes, mediated by `src/services/queryManifestService.ts` (referenced by 21 files). Its producer is `DBTProject.rebuildManifest()` feeding `src/manifest/parsers/*` from `manifest.json`.
- `DBTFusionCommandProjectIntegration extends DBTCloudProjectIntegration` (`src/dbt_client/dbtFusionCommandIntegration.ts`). **dbt Cloud cannot be deleted until Fusion is reparented.** This is the single hardest ordering constraint in the plan.
- Removal fanout, by count of files in `src` referencing the symbol: `TelemetryService` 51, `AltimateRequest` 39, `QueryManifestService` 21, `PythonEnvironment` 19, `UsersService` 11, `ValidationProvider` 9, `DeferToProdService` 8.
- `postInstall.js` downloads ZeroMQ prebuilds and rewrites a JupyterLab kernel; `prepareBuild.js` prunes ZeroMQ prebuilds per `vsce` target. Both exist only for notebooks and die with them.
- Tests are Jest with a hand-written VS Code mock (`src/test/mock/vscode.ts`) and an `@lib` mock; `@vscode/test-electron` is already a devDependency but no integration suite uses it.

### 2.4 Verified facts about the dbt Fusion LSP

Established by inspecting `dbt lsp --help` and the strings of the Fusion 2.0.5 binary at `~/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.5/dbt`. `dbt --version` prints `dbt 2.0.5` — note it does **not** contain the string `dbt-fusion`, which is why the current detection code fails.

Launch surface:

- `dbt lsp --socket <PORT>` — "Socket port to **connect to** for LSP communication". The server is the connecting party, so the extension listens and accepts. This is the reverse-socket transport.
- `--command-prefix <PREFIX>` — namespaces `workspace/executeCommand` command names.
- `--lint-enabled <true|false>` — SQL linter, disabled when unset.
- Project flags: `--project-dir`, `--profiles-dir`, `--profile`, `--target`, `--target-path`, `--packages-install-path`, `--vars`.
- Useful others: `--no-version-check`, `--log-level`, `--log-format`, `--static-analysis`, `--no-manage-state`, `--defer`, `--state`, `--favor-state`, `--threads`.
- Environment the server reads: `DBT_LSP_USE_TARGET_LSP`, `DBT_CLOUD_PUBLICATIONS_DIR`, `DBT_MAXIMUM_SEED_SIZE_MIB`, plus the standard `DBT_*` set.

Advertised server capabilities include `completionProvider`, `hoverProvider`, `signatureHelpProvider`, `definitionProvider`, `declarationProvider`, `typeDefinitionProvider`, `implementationProvider`, `referencesProvider`, `documentSymbolProvider`, `workspaceSymbolProvider`, `codeActionProvider`, `documentFormattingProvider`, `renameProvider`, `foldingRangeProvider`, `selectionRangeProvider`, `semanticTokensProvider`, `inlayHintProvider`, `codeLensProvider`, `diagnosticProvider`, and `executeCommandProvider`. **This is the list that makes five provider directories deletions rather than rewrites.**

Advertised `executeCommandProvider` commands, which appear in the binary as one contiguous registration array immediately before the watcher glob and the code action kinds: `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`. Those six are the whole advertised set.

`dbt.show`, `dbt.previewCte`, and `dbt.goToDefinition` appear *outside* that array, only alongside payload-validation and progress strings ("Missing dbt.show payload", "Missing compile file payload", `dbt/progress/show`). The likely reading is that they are handled but not advertised — which matters concretely: a client that validates outgoing commands against `initialize`'s `executeCommandProvider.commands` would reject them even though the server would answer. Do not filter against the advertised list, and confirm each of the three empirically in spike **S2**.

Progress notifications, which give the status-bar contract: `dbt/progress/listNodes` ("Computing Lineage"), `dbt/progress/getCurrentNode` ("Getting Columns"), `dbt/progress/compileFile` ("Compiling File"), `dbt/progress/references` ("Finding All References"), `dbt/progress/rename` ("Renaming Files"), `dbt/progress/show` ("Running Preview"). Note that `dbt.listNodes` is the lineage source and `dbt.getCurrentNode` the column source — model and column lineage do not need a bespoke command.

Other observed contracts: code action kinds `source.fixAll` and `source.fixAll.dbtLintFix`; a configuration section named `dbt-lsp` with `maxErrorReporting`, `linter`, and `formatter` subsections; a file watcher registration `default-dbt-file-system-watcher` over `**/*.{sql,csv}`; and server-side reads of `.dbtignore`, `.sqlfluff`, and `.sqlfluffignore`. Lineage response shapes appear as `ProjectLineageNodeDto` and `ColumnLineageNodeDto` (`node_name`, `parents`, `transformation_type` in `passthrough` / `transformation` / `raw`, `is_primary_key`), with `MaterializationKindDto`, `AccessDto`, `ResourceTypeDto`, and the failure flags `compilation_failed`, `lineage_query_failed`, and `models_count_is_estimate`.

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

**Keep the existing metadata event as the internal boundary and swap only its producer.** ADR 0002 could be read as "replace the metadata layer", which would mean rewriting every panel, tree view, and lens. It does not have to. `ManifestCacheProjectAddedEvent` plus the `src/domain.ts` map types is already the boundary, and `QueryManifestService` is already the mediator. Introduce a `ProjectMetadataSource` port whose output is exactly that event, ship a Fusion-LSP-backed implementation of it beside the existing manifest-backed one, flip a single internal switch, then delete `src/manifest/parsers/` and the parse loop. Every consumer is untouched, the switch is testable from both sides with the same assertions, and an entire "migrate the consumers" phase disappears.

**Five provider directories are deletions, not ports.** Because the Fusion server advertises `completionProvider`, `hoverProvider`, `definitionProvider`, `referencesProvider`, `renameProvider`, `documentFormattingProvider`, `codeActionProvider`, `semanticTokensProvider`, and `diagnosticProvider`, registering one `LanguageClient` supersedes `src/autocompletion_provider/`, `src/definition_provider/`, `src/hover_provider/`, `src/document_formatting_edit_provider/`, and `src/validation_provider/` wholesale. Do not port their logic. The only nuance is `src/code_lens_provider/`, which is mixed: the CTE and virtual SQL lenses drive local panels and survive; the documentation lens survives; the source-model-creation lens follows the feature.

### 2.7 Open decisions

**D1 — Reuse of consumer setup conveniences. Resolved.**

The tooling baseline in Section 2.3 is the realized answer: `mise` with a lockfile, `just` as the verb layer, `dprint` plus `rumdl` for Markdown, a macOS-only CI job with SHA-pinned actions, and `just check` as the single gate. Left behind, correctly: uv and Python packaging, the Snowflake CLI and key configuration, the sqlfluff dbt-interface server tasks, the dbt module and `local_packages` layout, Dagster, the Sigma CLI, the dbt JSON schemas, the multi-root `.code-workspace`, pytest conventions, and the branch-deploy CI shape.

The repository pins dbt Fusion 2.0.5 while the Consumer Repository tracks `latest`; this deliberately separates minimum-version compatibility tests from consumer update testing. Lefthook replaces Husky and lint-staged, and its commands dispatch the same lint gates as `just check`. Add `test`, `test-integration`, `smoke`, and `release` recipes only when the first phase that needs each one lands.

**D2 — Fork base version. Resolved.** The branch is rebased onto upstream 0.64.6. The inherited suite now contains 48 test suites and 637 passing tests, and the consumer's characterization cases describe the same upstream generation.

**D3 — Dependency diagnostics policy.** Provisional: suppress diagnostics whose URI lies under the packages install path, while surfacing one project-level blocker on `dbt_project.yml` when a dependency fails to parse. Resolve empirically in spike **S1** before Phase 5 step 5.5; if Fusion already scopes diagnostics to the root project, delete the filter rather than keeping dead defense.

**D4 — Folder-scoped `envFile` override.** Decision 8 permits one only if justified. Default to *not* adding it: Fusion already reads the project-root `.env`, and the extension inherits the editor environment. Revisit only if a consumer case fails in Phase 10.

## 3. Phases

Each step is one commit. Every step lists the files it touches, the contract at its seam, and its verification.

### Phase 0 — Close the tooling baseline — **complete**

**0.1 — Rebase onto the chosen base — complete.** The branch is based on upstream 0.64.6. Root and webview dependencies install with `npm ci`; `just check` and `just package` pass.

**0.2 — Pin Fusion and record the tooling decision — complete.** `mise.toml` pins dbt Fusion 2.0.5, `mise.lock` records both supported macOS archive checksums, and [`0004-repository-tooling.md`](../adr/0004-repository-tooling.md) records the decision.

Verify: `mise install` resolves 2.0.5; `dbt --version` under `mise exec` prints `dbt 2.0.5`; `just check` green.

### Phase 1 — Identity and activation gates

**1.1 — Product identity — package metadata complete.** Touch `package.json` (`name`, `displayName`, `publisher`, `description`, `version` → `0.1.0-alpha.0`, `icon`, `repository`, `homepage`, `bugs`, `categories`, `keywords`; drop `extensionDependencies` on `ms-python.python` and `altimateai.vscode-altimate-mcp-server`, keep `samuelcolvin.jinjahtml`; remove the `deploy-vscode` and `deploy-openvsx` scripts and the `ovsx` devDependency), delete the unused `package.nls.json`, and rewrite `README.md` to distinguish the current developer alpha from the local-only target. Retain the MIT and upstream copyright in `LICENSE`, remove stale Altimate identity assets, and delete `CONTRIBUTING.md`, `sweep.yaml`, `codecov.yml`, `.gitpod.yml`, `.nycrc.json`, and `documentation/`.

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

### Phase 2 — Characterization tests

Goal: lock in current behavior at the seams about to move, and encode the consumer's field-observed defects as failing tests that later phases turn green. No production code changes in this phase.

**2.1 — Fixture workspaces — complete.** Add `src/test/fixtures/`:

- `single-project/` — one root with `dbt_project.yml`, `models/`, a `profiles.yml`, one deliberately broken `ref()`.
- `multi-root/` — mirrors the consumer: `projects/general/` and `projects/sox/` as dbt projects, a `shared_packages/` non-project folder holding macros, a `pipelines/` folder with no `dbt_project.yml`, and a `projects/general/.state_copy/` containing a complete copy of a dbt project to reproduce the `.local_defs_state` case.
- `nested-project/` — a repository root that is *not* a dbt project with the project two levels down, for the explicit relative-root path.

Contract: fixtures are the shared vocabulary of every later test. Do not fork them per suite.

Verify: a smoke test asserts each fixture parses as YAML and that `multi-root` has exactly two real project roots plus one copy.

**2.2 — Integration harness — next.** Add `src/test/integration/` driven by the existing `@vscode/test-electron` devDependency, and a `just test-integration` recipe. The harness opens a fixture as a workspace, waits for activation, and exposes helpers to read diagnostics, request completions, and send `executeCommand`. Add `src/test/integration/lspFixture.ts` that can spawn `dbt lsp` directly against a fixture and speak LSP over the reverse socket without the extension, so protocol behavior can be characterized independently of extension bugs.

Contract: `just test-integration` requires the pinned Fusion on `PATH` and skips with a clear message otherwise; it never runs inside `just check`. Fusion 2.0.5 does not load a project-root `profiles.yml` on its own — pass `--profiles-dir` (or `DBT_PROFILES_DIR`) as the fixture's project directory, which already holds a dummy `profiles.yml`.

Verify: one integration test asserts the extension activates on `single-project` and that `dbt --version` resolves to Fusion 2.0.5.

**2.3 — Project scoping characterization.** Add `src/test/suite/projectScoping.test.ts` capturing, as tests, consumer cases 3, 4, 5, and 6: a folder-scoped setting value must win over a window-level value; a file outside any project must resolve a Project Context; a copied project tree must not register; and a workspace folder without a root `dbt_project.yml` must register nothing and create no watcher. Mark them `it.failing` (or `xit` naming the step that fixes them) against today's `DBTWorkspaceFolder`.

Verify: the suite runs and reports the expected failures; `just check` stays green.

**2.4 — Metadata contract snapshot.** Add `src/test/suite/metadataContract.test.ts` that builds a `ManifestCacheProjectAddedEvent` from the `single-project` fixture's `manifest.json` through the existing parsers and snapshots the resulting `NodeMetaMap`, `MacroMetaMap`, `SourceMetaMap`, `GraphMetaMap`, and `TestMetaMap` entries.

Contract: this snapshot is the acceptance test for the LSP-backed producer in Phase 6. Both implementations must satisfy the same assertions. Snapshot the *shape and key set*, not volatile values such as absolute paths or checksums.

Verify: snapshot committed; suite green.

---

### Phase 3 — Cut the unreachable subsystems → **alpha.1**

Goal: remove everything with no retained-feature consumer, before the hard work starts. This is the cheapest large reduction available and it shrinks the surface every later phase must reason about. Nothing here depends on the LSP.

Order within the phase matters only in that 3.1 makes 3.2–3.6 smaller.

**3.1 — Pin the integration to Fusion.** In `src/inversify.config.ts`, collapse the three `switch (dbtIntegrationMode)` factories to return the Fusion implementations unconditionally. Remove the `dbt.dbtIntegration` setting and the reload-on-change handler in `src/dbtPowerUserExtension.ts`. Remove `dbtPowerUser.switchDbtIntegration` and `dbtPowerUser.installDbt` and the integration branches in `src/dbt_client/index.ts`. **Leave the Core and Cloud classes in the tree** — `DBTFusionCommandProjectIntegration` still extends `DBTCloudProjectIntegration`, and reparenting is Phase 7 step 7.1. Dead-but-present is the correct intermediate state.

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

**3.7 — Latest majors (`chore/latest-majors`).** After 3.6, before Phase 4. The only compatibility ceiling is the Extensions API this product declares: `engines.vscode` and `@types/vscode` are the newest version both VS Code and Cursor actually support (Confirm if those diverge; take the intersection). Node, npm, TypeScript, the extension host module format, Inversify, React, ESLint, Vite, and every other direct dependency are fair game — newest published major with a caret (`^x.y.z`), or a replacement if the package is unmaintained or cannot take that major. Do not keep CommonJS, an old React, or an old Inversify as a freeze. Migrate `moduleResolution` off `node`/`node10` (`nodenext` or `bundler` as the compiler/bundler requires). No `ignoreDeprecations`. `engines.node` is `>=<current LTS major> <next major>`. Leave Fusion at 2.0.5 in `mise.toml`. SHA-pinned GitHub Actions stay SHA-pinned. Split into more than one PR if a single change is too large; do not leave leftovers unscheduled. `just check` and `just package` green.

**Tooling after 3.7 (not a gate).** Evaluate a report-only `just lint-complexity`. Do not add it to `just lint`, `just check`, Lefthook pre-push, or CI. Promoting it to a gate is a later Confirm, not before Phase 8.

---

### Phase 4 — The Declared Project model → **alpha.2**

Goal: replace recursive discovery with ADR 0003's model, and turn the Phase 2 failing tests green. Do this *before* the LSP work, because "one LSP process per Declared Project" is meaningless until the set of Declared Projects is correct.

**4.1 — Project configuration resolution.** New `src/projects/projectConfiguration.ts`.

```ts
/** Resolved project roots for one workspace folder, in declaration order. */
export interface DeclaredProjectRoots {
  folder: WorkspaceFolder;
  roots: Uri[];
  source: "explicit" | "folderRoot";
}
/** Reads `projects` scoped to the folder, falling back to the folder root when it holds dbt_project.yml. */
export function resolveDeclaredProjectRoots(folder: WorkspaceFolder): DeclaredProjectRoots;
```

Rules, all testable without VS Code running: read the setting with `workspace.getConfiguration(SECTION, folder.uri)` so folder values win over window values; interpret each entry as a path relative to the folder, accepting absolute paths; require `dbt_project.yml` at each resolved root and report a blocking configuration failure naming the offending entry when it is missing; when the setting is absent or empty, return the folder root if and only if it contains `dbt_project.yml`, otherwise return no roots; never walk the tree.

Verify: closes characterization cases 3, 5, and 6. Add cases for an explicit root that does not exist, an absolute root, a root outside the folder, and duplicate entries across folders resolving to the same path.

**4.2 — Project registry.** New `src/projects/projectRegistry.ts`, replacing `src/manifest/dbtWorkspaceFolder.ts`.

```ts
export interface DeclaredProject extends Disposable {
  readonly root: Uri;
  readonly name: string;
  readonly folder: WorkspaceFolder;
  contains(uri: Uri): boolean;
}
export interface ProjectRegistry extends Disposable {
  readonly projects: readonly DeclaredProject[];
  readonly onDidChangeProjects: Event<void>;
  /** Deepest-root-first match; undefined when the uri belongs to no Declared Project. */
  findProject(uri: Uri): DeclaredProject | undefined;
  /** Watches only each declared root's dbt_project.yml, never a recursive glob. */
  initialize(): Promise<void>;
}
```

A root under another project's packages install path is a Dependency Project and is rejected with an output-channel note, not a notification. Deduplicate roots that resolve to the same real path across folders. React to `workspace.onDidChangeWorkspaceFolders` and to configuration changes affecting the section.

Verify: on `multi-root`, exactly two projects register; `.state_copy` does not; `pipelines/` creates no watcher; `shared_packages/` registers nothing. Integration test asserts no `FileSystemWatcher` with a recursive pattern exists.

**4.3 — Project Context resolution.** New `src/projects/projectContext.ts`.

```ts
export interface ProjectContext {
  /** Project owning the active editor, else the project owning the active folder, else the sole project. */
  readonly current: DeclaredProject | undefined;
  readonly onDidChangeCurrent: Event<DeclaredProject | undefined>;
  /** Project owning a specific resource; used by commands that carry a uri. */
  forResource(uri: Uri): DeclaredProject | undefined;
  /** Prompts only when a user-invoked command needs a project and cannot infer one. */
  requireForCommand(uri?: Uri): Promise<DeclaredProject>;
}
```

Precedence for `current`: the active editor's URI, then `window.activeTextEditor`'s workspace folder, then the single registered project if there is exactly one, then undefined. Never silently default to "the first project" when more than one exists — that is the upstream behavior the consumer had to patch around, and it produced wrong-project lineage. Rewire `src/services/queryManifestService.ts` `getProject`, `getProjectByUri`, and `getOrPickProjectFromWorkspace` onto this, keeping their signatures so the 21 consuming files do not change.

Verify: closes characterization case 4. Integration test on `multi-root` opens a model in each project and asserts `current` follows, then opens a file in `pipelines/` and asserts `current` is undefined with no notification raised.

**4.4 — Retire the old discovery path.** Delete `src/manifest/dbtWorkspaceFolder.ts` and the `DBTProjectDetection` interface with its three implementations (`DBTCoreProjectDetection`, `DBTCloudProjectDetection`, `DBTFusionCommandProjectDetection`). Rewire `src/manifest/dbtProjectContainer.ts` onto `ProjectRegistry`. Remove `dbt.allowListFolders`.

Verify: `just check` green with the Phase 2 scoping suite now passing without `it.failing`; the two dbt folders of `multi-root` behave identically whether opened as a multi-root workspace or individually.

**Release alpha.2** (`0.2.0-alpha.0`). Worth installing in the consumer as a replacement for patch cases 2 through 7 even before the LSP lands: it validates the Declared Project model against the real repository shape while the manifest path still works.

---

### Phase 5 — LSP transport, client, and lifecycle → **alpha.3**

Goal: the first genuinely valuable alpha. Editor intelligence comes from Fusion, five provider directories are gone, and linting is on by default.

Run spikes **S2** (command payloads), **S3**, **S4**, **S5**, and **S6** before the steps that name them, and **S1** before step 5.5.

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

Verify: unit tests for configured-path precedence, variable substitution, a non-executable configured path (blocking failure naming the path), and absence from `PATH` (blocking failure). Stop using `src/manifest/pythonEnvironment.ts` on this path, but do not delete the file yet — Phase 8 removes it.

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

Verify: unit tests with a fake process that connects, never connects, exits immediately, and connects twice. Integration test against a real `dbt lsp` on `single-project` asserting a successful `initialize` whose result advertises `completionProvider`, `hoverProvider`, `definitionProvider`, `renameProvider`, `documentFormattingProvider`, `codeActionProvider`, `semanticTokensProvider`, and `diagnosticProvider`.

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

Arguments assembled per project: `lsp`, `--socket <port>`, `--project-dir <root>`, `--profiles-dir` when configured, `--target` when configured, `--lint-enabled <bool>`, `--no-version-check`, `--log-level` from the trace setting. `documentSelector` is scoped to the project root via a `RelativePattern`, so in a multi-root window each client sees only its own files — this is what prevents two clients from both answering for one document (**S3**).

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
  previewCte: "dbt.previewCte",
} as const;
```

`request` applies the prefix. Treat `show` and `previewCte` as unconfirmed until **S2**.

Lifecycle: restart with bounded exponential backoff on unexpected exit, cap the attempts, and on reaching the cap move to `failed` and log — do not notify. Dispose clients on project unregistration, workspace folder removal, configuration change affecting the executable or lint setting, and extension deactivation. Await process exit during disposal and escalate to `SIGKILL` after a grace period, so a window reload does not leak a server (**S4**).

Verify: unit tests for argument assembly, prefix application, backoff and cap, and disposal ordering. Integration tests: a `multi-root` window starts exactly two processes; deleting a project's `dbt_project.yml` stops exactly one; killing a server externally triggers exactly one restart; window teardown leaves no `dbt lsp` process (assert by PID list before and after).

**5.4 — Status and output.** New `src/lsp/fusionStatus.ts`. One status bar item reflecting the Project Context's client state, one output channel per project for server logs, and the server's `dbt/progress/*` notifications mapped to `window.withProgress` in the window location. Replace `src/statusbar/versionStatusBar.ts` and `targetStatusBar.ts`; delete `src/statusbar/deferToProductionStatusBar.ts` if defer moves into the LSP path in Phase 7.

Contract: this is where decision 9 is enforced. Startup, parse, restart, and failure are all status-and-output. Add a unit test that activates the extension against the fixtures with `window.showInformationMessage`, `showWarningMessage`, and `showErrorMessage` spied, asserting zero calls. Keep that test permanently as the notification-policy guard.

Verify: the spy test is green and CI-enforced.

**5.5 — Diagnostics policy.** Gated on **S1** and **D3**. The client's `middleware.handleDiagnostics` decides what reaches Problems. If the spike shows Fusion already confines diagnostics to the root project, implement nothing and record that in the ADR. If it does not, drop diagnostics whose URI is under the project's packages install path and, when a dependency failure would otherwise be invisible, publish one project-level diagnostic on `dbt_project.yml` naming the failing package.

Verify: integration test on a fixture with a deliberately broken dependency package asserting the policy either way, plus that a genuine error in a root-project model is never suppressed.

**5.6 — Delete the language providers.** Delete `src/autocompletion_provider/`, `src/definition_provider/`, `src/hover_provider/`, `src/document_formatting_edit_provider/`, and `src/validation_provider/` in full, along with their registration in `src/dbtPowerUserExtension.ts` and `inversify.config.ts`, the `dbtPowerUser.validateSql` command with `src/commands/validateSql.ts`, and the `dbt.sqlFmtPath` and `dbt.sqlFmtAdditionalParams` settings. In `src/code_lens_provider/`, keep `cteCodeLensProvider.ts`, `virtualSqlCodeLensProvider.ts`, and `documentationCodeLensProvider.ts`; the fate of `sourceModelCreationCodeLensProvider.ts` follows model generation in Phase 7.

Do not contribute a `documentSelector`-level formatter default and do not set `editor.formatOnSave`. Expose LSP formatting and code actions and let the repository or user decide (decision 7).

Verify: integration tests on `single-project` that completion inside `ref('` returns the fixture's models; hover on a dotted `package.macro` returns documentation (closing characterization case 1 through the LSP rather than a patch); go-to-definition on a `ref()` opens the model; rename across files works; a broken `ref()` yields a diagnostic; and `source.fixAll.dbtLintFix` is offered on a lint violation.

**Release alpha.3** (`0.3.0-alpha.0`). First release that delivers the ADR 0002 thesis. Install in the consumer alongside the manifest-driven panels and use it for daily editing.

---

### Phase 6 — Switch the metadata producer → **beta.1**

Goal: execute the Section 2.6 reframing. Panels keep their contract; the manifest parse loop dies.

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

Add `src/metadata/manifestMetadataSource.ts` as a thin adapter over today's `DBTProject.rebuildManifest()` and `src/manifest/parsers/`, with no behavior change, and route `dbtProjectContainer` through the port.

Verify: the Phase 2 metadata snapshot test passes through the port unchanged. No consumer file changes in this step — if one does, the boundary is wrong; stop and reconsider.

**6.2 — LSP-backed implementation.** New `src/metadata/lspMetadataSource.ts`, built on `dbt.getProjectInfo` for project-level facts (name, target, paths, adapter), `dbt.listNodes` for the node set and graph edges, and `dbt.getCurrentNode` for column detail, refreshing on the client's parse-complete signal rather than on a timer or file watcher. Where a map entry has no LSP source, read the Fusion artifact under the project's target path and record the gap in a single table in `docs/refactor/lsp-metadata-gaps.md` — one row per field, with the command or artifact that supplies it. That table is the evidence for "artifacts only where the LSP lacks data" and the checklist for revisiting when Fusion adds coverage.

Verify: the same Phase 2 snapshot assertions, now against the LSP source on the same fixture. Differences are either a bug to fix or a documented gap; nothing in between.

**6.3 — Flip and delete.** Bind `ProjectMetadataSource` to the LSP implementation. Then delete `src/manifest/parsers/`, `src/manifest/modules/targetWatchers.ts`, `src/manifest/modules/sourceFileWatchers.ts`, `src/metadata/manifestMetadataSource.ts`, and `DBTProject.rebuildManifest` with its debounce, diagnostics collection, and `dbt parse` invocation. Remove `dbt.disableDepthsCalculation` and `src/hover_provider/depthDecorationProvider.ts` if depth is not available from `dbt.listNodes`.

Contract: after this step no code in `src` reads `manifest.json`. Enforce it with a test that greps the compiled output.

Verify: `just check` green; full integration suite green; a model edit updates lineage and trees without a `dbt parse` subprocess (assert no `dbt parse` spawn during an edit).

**Release beta.1** (`0.4.0-beta.0`). No parallel semantic model remains.

---

### Phase 7 — Rebase commands and panels onto Fusion → **beta.2**

Goal: every retained capability in decision 11 works through Fusion and the LSP.

**7.1 — Reparent the Fusion integration.** Extract the parts of `DBTCloudProjectIntegration` that Fusion actually uses into a new `src/dbt_client/fusionProjectIntegration.ts` that extends nothing, and narrow `DBTProjectIntegration` in `src/dbt_client/dbtIntegration.ts` to the methods Fusion implements — dropping `validateSql`, `validateSQLDryRun`, `performDatapilotHealthcheck`, `fetchSqlglotSchema`, `validateWhetherSqlHasColumns`, `getPythonBridgeStatus`, and `generateDocs`, which Fusion does not support. This is the ordering constraint from Section 2.3; it unblocks Phase 8.

Verify: `just check` green; `grep -n "extends DBTCloud" src` empty; compile / run / build / test integration tests still pass.

**7.2 — Compile and preview.** Route `compileCurrentModel`, `sqlPreview`, `showCompiledSQL`, and `showRunSQL` through `dbt.compileFile` and `dbt.compileLsp`, falling back to `dbt compile` only where the LSP cannot serve the request. Keep `src/content_provider/sqlPreviewContentProvider.ts`.

Verify: integration tests asserting a compiled result for a model with a `ref()` and a macro, and that cancellation via the progress token actually cancels.

**7.3 — Run, build, test, clean, deps.** Keep the `DBTCommand` and queue machinery in `src/dbt_client/dbtIntegration.ts` and `src/commands/runModel.ts`, which are already CLI-shaped. Remove `PythonDBTCommandExecutionStrategy` and make `CLIDBTCommandExecutionStrategy` take the resolved `FusionExecutable` instead of a `PythonEnvironment`. Retain `runCurrentModel`, `buildCurrentModel` and its three graph-operator variants, `buildCurrentProject`, `testCurrentModel`, `runTest`, `runChildrenModels`, `runParentModels`, `cleanCurrentProject`, and `printEnvVars`; delete `generateDBTDocs`, since Fusion does not generate docs.

Verify: integration tests asserting argument construction for each command and that output reaches the terminal.

**7.4 — Query results, CTE preview, profiler, charting.** Route `executeSQL` through `dbt.show` when **S2** confirms it, else `dbt show --inline --output json`. Keep `src/webview_provider/queryResultPanel.ts` and `webview_panels/src/modules/queryPanel/`, including `@finos/perspective` and the charting path. Keep `src/code_lens_provider/cteCodeLensProvider.ts` and route it through `dbt.previewCte` when confirmed. Retain `dbt.queryLimit`, `dbt.queryScale`, `dbt.queryTemplate`, and `dbt.unquotedCaseInsensitiveIdentifierRegex`.

Note from the current Fusion code path: the JSON preview yields no column types, so every column arrives as `string`. Either recover types from `dbt.show` (check in **S2**) or make the panel's type display honestly absent rather than wrong.

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

**8.1 — dbt Core and dbt Cloud.** Delete `src/dbt_client/dbtCoreIntegration.ts`, `dbtCoreCommandIntegration.ts`, `dbtCloudIntegration.ts`, their factory bindings, and `src/test/suite/dbtCoreIntegration.test.ts`. Remove `dbt.dbtCustomRunnerImport` and `dbt.installDepsOnProjectInitialization` if initialization no longer runs `deps`.

**8.2 — The Python bridge.** Delete `dbt_core_integration.py`, `dbt_cloud_integration.py`, `altimate_packages/`, `src/manifest/pythonEnvironment.ts`, `DBTCommandExecutionInfrastructure.createPythonBridge` and `closePythonBridge`, and the `python-bridge` dependency. Remove the `ms-python.python` extension dependency and the Python launch configuration from `.vscode/launch.json`.

Verify: the unpacked VSIX contains no `.py` file; the extension activates with no Python interpreter selected.

**8.3 — Altimate and hosted remnants.** Delete `src/altimate.ts`, `src/services/sharedStateService.ts` if now unused, `src/test/suite/altimate.test.ts`, and the `dbt.altimateAiKey`, `dbt.altimateInstanceName`, and `dbt.altimateUrl` settings. Remove `NoCredentialsError` handling and `handlePreviewFeatures` from the command queue. Drop `node-fetch` and `node-abort-controller`.

Contract: no `SecretStorage` use, no credential prompt, no authentication code path anywhere. Add a test asserting `context.secrets` is never touched.

**8.4 — Prune the webview bundle.** Remove the now-unreachable modules under `webview_panels/src/modules/` and their routes, and prune `webview_panels/package.json` of dependencies only they used. Keep `@finos/perspective`, the lineage stack, Redux Toolkit, and Antd. Drop `webview_panels/` from the `rumdl.toml` exclude list if any Markdown survives there.

Verify: `just package` succeeds; record the VSIX size before and after in the commit message as the concrete measure of what Phases 3 and 8 removed.

**8.5 — Walkthroughs, quick picks, and dead contributions.** Rewrite `src/commands/walkthroughCommands.ts` and the `walkthroughs` contribution for the local Fusion setup story; remove the setup-wizard paths that installed dbt or switched integrations. Prune `src/quickpick/` to what remains. Audit every remaining entry in `contributes.commands`, `menus`, `submenus`, `views`, `viewsContainers`, and `keybindings` against the implemented set.

Verify: a test asserting every `contributes.commands` entry has a registration in `src` and every registration has a contribution — no orphans in either direction. Keep it permanently; it is the cheapest guard against contribution drift.

**Release beta.3** (`0.6.0-beta.0`).

---

### Phase 9 — Namespace, distribution, and docs → **1.0.0**

**9.1 — Settings and command namespace.** Rename every setting to `fusionPowerUser.*` and every command to `fusionPowerUser.*` in one commit, with no fallback reads of `dbt.*` and no deprecation aliases (decision 13). Set `scope` correctly per property: `resource` for project, executable, lint, and enablement settings so folder values work; `window` only where genuinely window-wide. Write `docs/settings-migration.md` with the full mapping, including the settings the consumer actually sets:

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
| —                                                                                                                                                                                                                            | `fusionPowerUser.profilesDir`, `fusionPowerUser.target` (new)                               |
| —                                                                                                                                                                                                                            | `fusionPowerUser.trace.server` (new)                                                        |

Verify: the orphan test from step 8.5; a test asserting no `contributes.configuration` key begins with `dbt.` and no `getConfiguration("dbt")` call remains in `src`.

**9.2 — Documentation.** Extend `CONTEXT.md` with any term Phases 4 through 7 introduced (candidates: **Fusion Client**, **Project Metadata Source**). Write `docs/architecture.md` for the *why* per the prose rules — activation, Declared Projects, the client pool, the metadata port, the panels — and `docs/lsp-metadata-gaps.md` from step 6.2. `AGENTS.md` and `CLAUDE.md` are already fork documents; update their command list and gates rather than rewriting them. Update `README.md` with install-from-release instructions, the macOS-only scope, the Fusion 2.0.5 minimum, and the `PATH`-based `mise-vscode` note from step 5.1.

**9.3 — VSIX smoke test.** Add `scripts/smoke.sh` — POSIX `sh`, `usage:` on `--help`, `--force` — and a `just smoke` recipe. It packages the VSIX, then for each of `code` and `cursor` that exists on `PATH`: installs the VSIX, launches the editor on the `multi-root` fixture with a disposable user-data directory, and asserts activation, one successful LSP round trip, zero startup notifications, and no surviving `dbt lsp` process after exit. Make the per-editor result explicit in the output so a Cursor-only failure is visible (**S6**).

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

## 4. Risks, spikes, and checkpoints

### Spikes — do these before the step that depends on them

**S1 — Dependency diagnostics.** Before Phase 5 step 5.5. Using `src/test/integration/lspFixture.ts`, run `dbt lsp` on a fixture with an installed package containing a deliberate error, and record every `textDocument/publishDiagnostics` URI and severity. Determine whether Fusion already confines diagnostics to the root project and whether a dependency parse failure surfaces at all. Output: resolve **D3** and record it in `docs/adr/0005-dependency-diagnostics.md`. Time-box half a day.

**S2 — Custom command payloads.** Before Phase 5 step 5.3, and blocking on Phase 7. The command *names* are already known (Section 2.4). What is unknown is each command's argument and response schema, and whether `dbt.show`, `dbt.previewCte`, and `dbt.goToDefinition` are actually registered. Drive each of `dbt.getProjectInfo`, `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.show`, and `dbt.previewCte` over the socket against `single-project`, and record request and response JSON in `docs/refactor/lsp-commands.md`. Confirm whether `dbt.show` returns column types, which decides step 7.4. Also confirm `--command-prefix` semantics: whether the prefix replaces or prepends the `dbt.` segment. Time-box one day. **This is the largest single unknown in the plan; if a retained feature has no command and no artifact behind it, surface that before Phase 7 rather than discovering it mid-phase.**

**S3 — Multi-root Project Context.** Before Phase 5 step 5.3. Confirm that a per-project `documentSelector` built from a `RelativePattern` actually prevents two clients from both answering for one document, and check the behavior for a file open in no workspace folder and for a `.sql` file inside a project's `target/`. Time-box two hours.

**S4 — Process lifecycle.** Before Phase 5 step 5.3. Measure resident memory and startup time for one `dbt lsp` on a project of the consumer's size, then for two concurrently. Confirm whether the server exits on its own when the client socket closes or must be signalled, and whether a window reload leaves an orphan. Establish the `SIGTERM`-to-`SIGKILL` grace period empirically. Time-box half a day.

**S5 — Coexistence with the official dbt extension.** Before Phase 5 step 5.3. Install `dbtlabs.dbt` alongside a development build and check for collisions in `workspace/executeCommand` names, language configuration, `files.associations`, and duplicated diagnostics. This is not the same as the upstream Power User conflict in step 1.3: the official extension is a legitimate coexistence case for a user who also uses dbt Platform. Decide whether to coexist via `--command-prefix` or to add a second conflict guard. Time-box two hours.

**S6 — Cursor parity.** Before Phase 5 step 5.2. Confirm the chosen `vscode-languageclient` major loads in Cursor's extension host and that `engines.vscode` is satisfiable there, since Cursor tracks a VS Code version behind upstream. Confirm `cursor --install-extension` accepts a local VSIX path. A failure here changes the `vscode-languageclient` pin and the `engines.vscode` floor, so it must precede the dependency being added. Time-box two hours.

### Risks, ranked by how likely they are to change the plan

1. **A retained feature has no LSP command and no artifact.** Most likely candidates: the CTE profiler's statistics, query-result column types, and defer against local state. Mitigation: **S2** before Phase 7. Response: cut the feature and record it, rather than reviving a Python path.
2. **The `0.64.6` rebase is worse than estimated.** Mitigation: attempt it while the only local changes are documents and tooling, and abandon after a day (**D2**).
3. **Two `dbt lsp` processes on a large monorepo are too slow or too heavy.** Mitigation: **S4** measures it before the design is committed. Response: start clients lazily on first file open per project rather than at activation — a change localized to `FusionClientPool`, which is why the pool is a separate seam.
4. **Deleting telemetry (51 files) or Altimate (39 files) breaks something subtly.** Mitigation: both are mechanical deletions whose only success criterion is "compiles and tests stay green", and both come after the Phase 2 characterization suite exists.
5. **`ManifestCacheProjectAddedEvent` turns out to be the wrong boundary** — for instance, the LSP cannot populate a field that three panels require. Mitigation: Phase 6 step 6.1's rule that no consumer file changes. If one must, stop: that is the signal the boundary is wrong, and it is far cheaper to learn at 6.1 than at 6.3.
6. **Cursor and VS Code diverge in extension-host behavior.** Mitigation: **S6** early, and a VSIX smoke test that reports per-editor results for the life of the project.
7. **Fusion licensing gates a retained capability.** Decision 4 forbids working around it. Response: detect the gate, surface Fusion's own message, and mark the capability unavailable. Never implement a bypass.
8. **Concurrent sessions overwrite each other's work in this repository.** This plan file was itself overwritten once during authoring. Mitigation: commit each step before starting the next, and re-read a document before editing it rather than rewriting from memory.

### Checkpoints — stop and confirm

**D1** and **D2** are resolved; Phase 0 and Phase 1.1 are complete.

- **Before Phase 5 step 5.5:** **D3**, resolved by **S1**.
- **Before Phase 7:** the **S2** command inventory, with any retained feature that has no backing command named explicitly. This is the point where the comprehensive target either holds or must be amended.
- **Before Phase 8:** confirm beta.2 has been used against the real consumer repository long enough to trust it. Phase 8 is where the old paths stop being available as a fallback.
- **Before Phase 10 step 10.4:** all seven consumer characterization cases verified green through the fork.

### Hard-to-reverse steps

Phase 6 step 6.3 (deleting the manifest parsers), Phase 8 in its entirety, and Phase 9 step 9.1 (the namespace rename) are expensive to undo. Each is preceded by a release, so the prior artifact remains installable and pinned in the consumer while the next one is validated. Do not batch any of them with another step.
