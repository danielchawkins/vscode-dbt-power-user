# Fusion editor flow capture (Phase 5.6)

Captured with the merged `LspFixture` harness in `src/test/integration/fusionEditorFlowsCapture.test.ts`. Dummy Snowflake profile only (`single_project` / `test`). No warehouse login, no `clearTarget`, no persisted SQL. The test is **opt-in** (`FPU_RUN_EDITOR_FLOW_CAPTURE=1`); default integration runs skip it. Indexed here and in the Before 5.6 gate row in [`remaining-implementation.md`](remaining-implementation.md); no separate numbered spike-table row — this harness is the gate artifact itself.

## Method

The harness copies `src/test/fixtures/single-project` into a temp directory and rewrites a **parse-clean** project before `dbt deps` / `dbt parse`:

- Valid model chain (`base` → `child`), dedicated `completion_probe.sql`, `diagnostic_model.sql`, lintable/format-able models, schema docs.
- Local package `vendor/editor_flow_pkg` with macro `packaged_macro` for dotted hover (`editor_flow_pkg.packaged_macro`).
- All model, macro, and package files exist before preflight; nothing is created silently after parse.

Launch matches production shape: deterministic `--command-prefix fpu-editor-flow-capture:`, prefixed `workspace/executeCommand` names, `--lint-enabled true`, `--static-analysis baseline`, dummy profile/target. No `--target-path` is passed; snapshots observe the project default `target/` tree for profile `test`. Spawned-process `DBT_TARGET_PATH` / env overrides are **not** recorded, so before/after target evidence is scoped filesystem metadata only — not S7 discharge, bootstrap licensing, or proof of compile output.

The live server requests workspace configuration section **`dbt`** (not `dbt-lsp`); the harness maps responses by requested section. Requested and delivered section keys are sampled **after** editor flows so late `workspace/configuration` calls count; delivered sections come from handler observations (non-null section mappings actually returned), not a static intersection guess.

After `initialized`, the client opens every relevant document and waits for `Did open:` log lines (no fixed sleep). `textDocumentSync` is incremental (`change=2`); `didChange` sends a ranged replacement over the prior buffer, updates the per-URI version map, and waits for `Did change:` / `Did save:` log acks.

Editor probes use isolated documents:

- **Completion:** monotonic `didChange` on `completion_probe.sql` to a partial `ref('`, completion request, restore valid text, `didSave`.
- **Hover:** two positions on `pkg_macro_user.sql` — package qualifier (`editor_flow_pkg`) and macro segment after `editor_flow_pkg.` (Phase 5.6 criterion uses the macro probe).
- **Broken ref diagnostic:** incremental change on loaded `child.sql` to `ref('missing_model')` (no post-parse file creation).
- **Syntax diagnostic:** incremental change on loaded `diagnostic_model.sql` to invalid SQL.
- **Lint code action:** `textDocument/codeAction` on `diagnostic_model.sql` with diagnostics sourced from the **absolute** captured `publishDiagnostics` set for that URI. When `diagnosticsPassed=0`, the probe is marked **not exercised** (`exercised: false`); the criterion is untested, not failed. `lintable.sql` remains in the fixture so the capture shape is unchanged.

Each request outcome is classified: `ok`, `null`, `empty`, `error`, `timeout`. JSON-RPC errors preserve `lspErrorCode` (numeric) separately from `timeoutMethod`; generic handler failures use `requestFailed`. **`textDocument/prepareRename`** returns `-32601` (MethodNotFound — not implemented on the server). The initialize result advertises **`textDocument/rename`**, but rename returns `null`/no edits on arm C while timing out on unloaded arms A/B; 5.6 cross-file rename remains unmet, but unsupported prepare is distinct from an empty rename response.

Three arms, fresh process each, **n=2** per arm (reproducibility compares outcome-class signatures, not progress titles or exact counts):

| Arm | Trigger after did-open readiness                        |
| --- | ------------------------------------------------------- |
| A   | none                                                    |
| B   | prefixed `dbt.listNodes`                                |
| C   | prefixed `dbt.listNodes` then prefixed `dbt.compileLsp` |

Per-arm runtime budget is 75s; suite timeout scales to six arm runs. Default integration runs skip the capture; `just check` stays green.

**Target evidence (arm C only):** before/after snapshots of the project's default `target/manifest.json` and `target/compiled/**` (size, mtime, sha256) around `compileLsp`, with a 500ms settle wait. No `--target-path` was passed and the spawned environment was not recorded, so overrides are not excluded. Reports `changedPaths`, `newlyPresent`, `removedPaths`, and `hashChanged`. Paths outside the snapshot set and any write/delete/revert wholly between snapshots are invisible; this does not discharge S7 or license a production bootstrap.

Prefixed `dbt.getProjectInfo` is recorded for outcome shape only — **not** load proof (S2: `{}` is inconclusive; `ok`/`object` shape does not assert a loaded projection).

## Reproduction

```bash
just check
npm run compile:integration
cp src/test/integration/out-package.json out/package.json
FPU_RUN_EDITOR_FLOW_CAPTURE=1 \
  npx mocha --ui tdd out/test/integration/fusionEditorFlowsCapture.test.js --timeout 600000
```

The test prints `FPU_EDITOR_FLOW_CAPTURE=` with redacted labels and diagnostic summaries (no absolute paths, no diagnostic text, no SQL).

## Latest observed matrix (Fusion 2.0.5, 2026-09-22)

| Flow                                               | A             | B                 | C                                   |
| -------------------------------------------------- | ------------- | ----------------- | ----------------------------------- |
| Preflight deps/parse                               | 0/0           | 0/0               | 0/0                                 |
| Completion partial `ref('` → `base`                | `null`        | `null`            | **`ok`** (labels include `base`, …) |
| Hover package qualifier `editor_flow_pkg`          | `null`        | `null`            | `null`                              |
| Hover macro segment `packaged_macro` (5.6)         | `null`        | `null`            | `null`                              |
| Definition → `models/base.sql`                     | `null`        | `null`            | `null`                              |
| prepareRename (MethodNotFound `-32601`)            | `error`       | `error`           | `error`                             |
| rename (timeout A/B; null/no edits C)              | `timeout`     | `timeout`         | `null`                              |
| formatting `TextEdit[]`                            | `null`        | `null`            | **`ok`** (1 edit)                   |
| broken-ref push on `child.sql` (since cursor)      | none          | none              | none                                |
| broken-ref absolute summaries (relative URI/code)  | none          | none              | 6 (base, pkg_macro_user; not child) |
| pull diagnostics                                   | unavailable   | unavailable       | unavailable                         |
| lint `dbtLintFix`                                  | not exercised | not exercised     | not exercised (0 diags on model)    |
| getProjectInfo (shape only)                        | `object`      | `object`          | `object`                            |
| Trigger progress                                   | none          | Computing Lineage | Computing Lineage                   |
| config sections requested                          | 0             | 0                 | 1 (`dbt`)                           |
| config sections delivered (handler observed)       | 0             | 0                 | 1 (`dbt`)                           |
| Target before/after compileLsp (default `target/`) | —             | —                 | no created/changed/removed paths    |

### Headline

Arm **C** reproducibly produces a **partial usable projection** after mandatory `--command-prefix` and **`dbt.compileLsp`**: completion and formatting return `ok`. That path is not production-shaped and showed no target hash/size/mtime changes on the default `target/` tree after a 500ms settle.

Arms **A**/**B** stay unloaded for editor flows (consistent with S10). Configuration requests are asymmetric: A/B request zero sections; C requests and receives `dbt`.

## Phase 5.6 criteria verdict

| Criterion                                                   | Result                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Completion in `ref('` lists expected fixture model label(s) | **Fail** on A/B; **pass** on C                                          |
| Hover on dotted `package.macro` (macro segment)             | **Fail** all arms                                                       |
| Go-to-definition on complete `ref()` → expected model path  | **Fail** all arms                                                       |
| Prepare/rename cross-file edits (not applied)               | **Fail** all arms (prepare MethodNotFound; rename empty/timeout)        |
| Document formatting returns `TextEdit[]`                    | **Fail** on A/B; **pass** on C                                          |
| Broken `ref()` push/pull on edited loaded file              | **Fail** (no since-cursor child summaries)                              |
| `source.fixAll.dbtLintFix` with real diagnostics            | **Untested** (probe not exercised; 0 diagnostics on `diagnostic_model`) |

## Gate status (dummy-Snowflake run, superseded below)

**5.6 remains blocked on this run.**

- S10 loaded-project control absent on production-shaped arms A/B.
- Provider deletion **not** recommended: most 5.6 flows fail even after arm C's `compileLsp` trigger; arm C depends on non-production execute commands and prefix.
- Do not treat prefixed `getProjectInfo` `object` shape as loaded-project proof.

## Working-DuckDB run (Fusion 2.0.5, 2026-09-23)

The dummy Snowflake profile never let a model resolve, run, or load, so the arm-A/B nulls above were
consistent with an unloaded project, not a proven server limitation (S10 gap). `single-project`,
`multi-root/projects/{general,sox}`, and `nested-project/projects/analytics` now carry a real `duckdb`
profile output (`type: duckdb`, `path: target/<profile>.duckdb`, gitignored). `dbt build` was verified in
temp copies for all four (Method below); none of these paths lands in the tracked tree.

Two harness bugs, not product bugs, were making arms A/B look unloaded. `src/lsp/fusionLanguageClient.ts`
already implements the official client's contract exactly: spawn `cwd` is the project root, spawn `env`
sets `DBT_LSP_USE_TARGET_LSP=1`, and `buildWorkspaceConfigurationResponse` returns only
`{lsp:{linter:{enabled}}}` for section `dbt` (see `docs/refactor/official-client-contracts.md`). The capture
test in `fusionEditorFlowsCapture.test.ts`, which drives the raw protocol directly and bypasses that client,
did none of the three: it spawned with the default (non-project) cwd, never set `DBT_LSP_USE_TARGET_LSP`,
and answered `workspace/configuration` with `{maxErrorReporting, linter, formatter}` — a shape Fusion's
production config parser does not expect. `src/test/integration/lspFixture.ts` also used `os.tmpdir()`
directly; on macOS that resolves through `/tmp -> /private/tmp`, and Fusion canonicalizes `--project-dir`
but not document URIs (documented symlink hazard), so it now takes `fs.realpathSync(os.tmpdir())`.

### Method

Same `LspFixture` harness and same rewritten parse-clean project as the 5.6 method above (valid `base` →
`child` chain, `vendor/editor_flow_pkg` local package, `pkg_macro_user.sql` for dotted hover), now against
the `duckdb` profile, with `configurationBySection: {dbt: {lsp: {linter: {enabled: true}}}}`,
`env: {DBT_LSP_USE_TARGET_LSP: "1"}`, and `useProjectRootAsCwd: true`. `.sqlfluff` dialect changed from
`snowflake` to `duckdb` to match. No other flow logic changed.

### Reproduction

```bash
just check
npm run compile:integration
cp src/test/integration/out-package.json out/package.json
FPU_RUN_EDITOR_FLOW_CAPTURE=1 \
  npx mocha --ui tdd out/test/integration/fusionEditorFlowsCapture.test.js --timeout 600000
```

### Buildability proof

Each fixture was copied to a temp directory (mirroring the existing `broken_ref.sql`-removal convention in
`src/test/integration/runTests.ts`) and built directly:

| Fixture                                           | Command                      | Result            |
| ------------------------------------------------- | ---------------------------- | ----------------- |
| `single-project` (broken_ref removed, child→base) | `dbt build --profiles-dir .` | success, 2 models |
| `multi-root/projects/general`                     | `dbt build --profiles-dir .` | success, 1 model  |
| `multi-root/projects/sox`                         | `dbt build --profiles-dir .` | success, 1 model  |
| `nested-project/projects/analytics`               | `dbt build --profiles-dir .` | success, 1 model  |

The tracked `single-project/models/broken_ref.sql` (`ref("missing_model")`) is unchanged and still fails a
literal `dbt build` on the tracked tree — every integration test that spawns `dbt` against this fixture
already removes or rewrites it in its own temp copy before running (`runTests.ts`,
`targetIsolationRegression.test.ts`, `s7TargetMutationCapture.test.ts`,
`fusionEditorFlowsCapture.test.ts`'s `prepareEditorFlowProject`); this run follows that existing convention
rather than changing the deliberately-broken characterization fixture `fixturesSmoke.test.ts` asserts on.

### Latest observed matrix (Fusion 2.0.5, 2026-09-23, working DuckDB project)

| Flow                                                       | A                                                                         | B                 | C                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------- | --------------------------------- |
| Preflight deps/parse                                       | 0/0                                                                       | 0/0               | 0/0                               |
| Completion partial `ref('` → fixture models                | **`ok`** (7 labels)                                                       | **`ok`**          | **`ok`**                          |
| Hover package qualifier `editor_flow_pkg`                  | `null`                                                                    | `null`            | `null`                            |
| Hover macro segment `packaged_macro` (5.6)                 | `null`                                                                    | `null`            | `null`                            |
| Definition → `models/base.sql`                             | **`ok`** (matches)                                                        | **`ok`**          | **`ok`**                          |
| prepareRename (MethodNotFound `-32601`)                    | `error`                                                                   | `error`           | `error`                           |
| rename (advertised, empty edit)                            | `empty`                                                                   | `empty`           | `empty`                           |
| formatting `TextEdit[]`                                    | **`ok`** (1 edit)                                                         | **`ok`**          | **`ok`**                          |
| broken-ref absolute diagnostics (`base`, `pkg_macro_user`) | 8                                                                         | 10                | 9                                 |
| broken-ref since-cursor diagnostics (edited file)          | 0                                                                         | 0                 | 0                                 |
| pull diagnostics                                           | unavailable                                                               | unavailable       | unavailable                       |
| lint `dbtLintFix`                                          | not exercised (0 diags on model)                                          | not exercised     | not exercised                     |
| getProjectInfo                                             | **`ok`** (`models_count:2`, `is_estimate:false`, `adapter_type:"duckdb"`) | same              | same                              |
| Trigger progress                                           | none                                                                      | Computing Lineage | Computing Lineage + report stream |
| config sections requested / delivered                      | 1 (`dbt`) / 1                                                             | 1 / 1             | 1 / 1                             |
| Target before/after compileLsp (arm C, default `target/`)  | —                                                                         | —                 | no created/changed/removed paths  |

### Headline

With a real DuckDB profile and the corrected spawn contract (cwd, env, config shape), **arms A and B now
load** exactly like arm C: completion, definition, formatting, and `getProjectInfo` all return real content
on the very first `didOpen`, with no explicit `dbt.listNodes` / `dbt.compileLsp` trigger. This matches the
official client's documented behavior ("first didOpen triggers compile") and confirms the earlier arm A/B
nulls were an artifact of an unloaded project (dummy Snowflake) and a non-conforming test harness, not a
Fusion or Fusion Power User limitation on unprimed arms.

`getProjectInfo` now reports a real `models_count` (`2`, not estimated) and `adapter_type: "duckdb"`,
which the 5.6 note above explicitly withheld as load proof; it is load proof here because the count matches
the fixture's two real models.

Two flows remain `null`/unsupported on every arm even with a genuinely loaded project: hover on any macro
invocation (`packaged_macro()`, dotted or not — verified against a same-package, non-dotted macro call too),
and `dbt.listNodes` / `dbt.getCurrentNode` (verified directly, ad hoc, against the loaded project; see
`docs/refactor/lsp-commands.md`). `dbt.compileFile`, previously reported as never returning compiled SQL,
succeeds once given a bare URI **string** argument (not an object) against a loaded project — the earlier
report's negative result was an unloaded project plus untried argument shape, not a server limitation.

### Phase 5.6 criteria verdict (working-DuckDB run)

| Criterion                                                   | Result                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Completion in `ref('` lists expected fixture model label(s) | **Pass** on A/B/C                                                                          |
| Hover on dotted `package.macro` (macro segment)             | **Fail** all arms — server does not resolve macro-call hover at all, not package-specific  |
| Go-to-definition on complete `ref()` → expected model path  | **Pass** on A/B/C                                                                          |
| Prepare/rename cross-file edits (not applied)               | **Fail** all arms (prepare MethodNotFound; rename advertised but empty)                    |
| Document formatting returns `TextEdit[]`                    | **Pass** on A/B/C                                                                          |
| Broken `ref()` push/pull on edited loaded file              | **Fail** (no since-cursor summaries on the edited file in this run; unresolved, see below) |
| `source.fixAll.dbtLintFix` with real diagnostics            | **Untested** (fixture's `diagnostic_model.sql` has no lint violation by design)            |

### Gate status

**5.6 partially discharged.** Completion, go-to-definition, formatting, and project-load evidence
(`getProjectInfo`) now pass on production-shaped arms A/B with no trigger commands — the S10 loaded-project
control this doc previously lacked. Hover-on-macro and rename remain genuinely unmet on a loaded project;
these are candidate product findings, not harness artifacts, and are not fixed here (see the parity section
below). The broken-ref since-cursor diagnostic gap is unresolved: `absoluteSummaries` show live diagnostics
on unrelated open files (`base.sql`, `pkg_macro_user.sql`) in the same run, so diagnostics are flowing, but
the specific probe (an incremental edit to `child.sql` introducing `ref('missing_model')`) produced no
since-cursor diagnostic in this run — timing or a stale watch window is the leading hypothesis, not
confirmed.

## Official-client parity (2026-09-23)

Scope: dbtLabsInc.dbt is the parity target for every flow that does not require authentication or a Cloud
feature. See `docs/refactor/official-client-contracts.md` for the captured contract this section checks
Fusion Power User against.

### A. Contract diff — Fusion Power User's client vs. the official contract

No deviation found in product code. `src/lsp/fusionLanguageClient.ts` and `src/lsp/fusionClientSettings.ts`
already match every documented official-client behavior:

- **cwd**: `startTransport` spawns with `this.options.project.root.fsPath` as `cwd` — the project root, per
  contract.
- **`DBT_LSP_USE_TARGET_LSP=1`**: set unconditionally in the spawn `env` (`fusionLanguageClient.ts:594-597`),
  matching the contract's "always sets" claim.
- **Workspace configuration shape**: `buildWorkspaceConfigurationResponse` returns exactly
  `{lsp:{linter:{enabled}}}` for section `dbt` and `null` otherwise (`fusionLanguageClient.ts:225-239`),
  matching the contract's minimal-shape requirement.
- **Compile trigger**: production sends no explicit `compileLsp`/`clearTarget` at startup; those are
  user-invoked commands only (`FUSION_LSP_COMMANDS`), matching "first didOpen triggers compile, no automatic
  bootstrap."
- **Document selector / capabilities**: `documentSelectorForProject` scopes `jinja-sql`/`sql`/`yaml` under
  the Declared Project's `RelativePattern` base, consistent with per-project isolation; no capability
  advertises anything the contract doc doesn't list as supported by Fusion.
- **Symlink hazard**: the contract's known hazard is a server-side limitation (canonicalizes `--project-dir`,
  not document URIs); Fusion Power User passes `project.root.fsPath` as-is and does not add path rewriting,
  matching the contract doc's explicit "this correction does not add path rewriting."

The deviations were entirely in the **test harness**, not product code: `fusionEditorFlowsCapture.test.ts`
omitted `cwd`/`DBT_LSP_USE_TARGET_LSP`/the correct config shape (fixed above), and
`lspFixture.ts` didn't canonicalize `os.tmpdir()` (fixed above). No product PR is warranted from this diff.

### B. Control run (official VSIX)

`dbtlabsinc.dbt-0.104.0-universal` is installed locally (`~/.vscode/extensions`,
`~/.cursor/extensions`), older than the `0.107.8` the contract doc captured. Driving a live VS Code window
through that extension to capture its actual LSP traffic against the DuckDB fixture requires UI automation
or an interactive session; that was not done in this pass given the spike's remaining budget. Per the
fallback this task allows, parity below rests on the raw-LSP capture above and two ad hoc follow-up probes
against the same loaded, duckdb-backed `single-project` temp copy (ad hoc scripts, not checked in):
hover/definition on `ref("base")`, and `dbt.listNodes` / `dbt.getCurrentNode` / `dbt.compileFile` /
`dbt.show` called directly after `didOpen` + a settle wait. Obtaining and driving the official VSIX for a
true control run is a follow-up, not done here.

### C/D. Parity table

| Flow                                               | Official client (contract doc)            | Raw LSP, loaded DuckDB project                                                                                            | Fusion Power User (same client code) | Cause if different                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion in `ref('`                              | advertised, works                         | `ok`, real labels                                                                                                         | expected `ok` (same client)          | —                                                                                                                                                                                                                                                         |
| Hover on `ref("base")`                             | advertised (`hoverProvider`)              | `ok` — `"**Children Models**\n\n- child"`                                                                                 | expected `ok`                        | —                                                                                                                                                                                                                                                         |
| Hover on a macro call (`example()`, dotted or not) | advertised (`hoverProvider`)              | `null`, even same-package non-dotted                                                                                      | expected `null`                      | Fusion 2.0.5's hover provider does not resolve macro-call identifiers at all; ref/source hover works. Server limitation, not a client bug.                                                                                                                |
| Go-to-definition on `ref()`                        | advertised (`definitionProvider`)         | `ok`, resolves to `models/base.sql`                                                                                       | expected `ok`                        | —                                                                                                                                                                                                                                                         |
| Rename                                             | advertised (`renameProvider`)             | `prepareRename` → `-32601` MethodNotFound; `rename` → empty edit                                                          | expected same                        | Server advertises `rename` without `prepareRename`, and returns an empty edit for this fixture; unresolved whether any input produces a non-empty edit.                                                                                                   |
| Formatting                                         | advertised (`documentFormattingProvider`) | `ok`, 1 edit                                                                                                              | expected `ok`                        | —                                                                                                                                                                                                                                                         |
| Diagnostics on a broken ref                        | no `diagnosticProvider` (push only)       | push diagnostics active (8-10 per run on other open files); 0 since-cursor on the edited probe file                       | expected same push behavior          | Unresolved — timing/stale-watch hypothesis, not confirmed. Flag for follow-up, not a fix here.                                                                                                                                                            |
| Code actions (`dbtLintFix`)                        | advertised (`codeActionProvider`)         | untested — fixture's `diagnostic_model.sql` has no lint violation                                                         | expected same, untested              | Fixture design, not a bug.                                                                                                                                                                                                                                |
| `dbt.listNodes`                                    | advertised, "project lineage"             | `null`, even on a fully loaded project (`getProjectInfo.models_count:2`)                                                  | expected `null` via same client      | **Unresolved.** Only documented argument shape (`[]`) tried; needs product-side investigation (`file:extensionDevelopmentPath` not applicable — see `src/lsp/fusionLanguageClient.ts` `FUSION_LSP_COMMANDS.listNodes`) before assuming server limitation. |
| `dbt.getCurrentNode`                               | advertised, "column-level metadata"       | `null`                                                                                                                    | expected `null`                      | **Unresolved**, same caveat as `listNodes`.                                                                                                                                                                                                               |
| `dbt.compileFile`                                  | advertised, per-file compile              | `ok` with a bare URI **string** argument (`arguments: [uri]`); object-shaped arguments still error                        | expected `ok` with the string shape  | Earlier `lsp-commands.md` capture ran on an unloaded, dummy-Snowflake project and never tried the plain-string shape as the sole argument on a loaded project; not a server limitation.                                                                   |
| `dbt.show`                                         | advertised, "execute a SELECT statement"  | executes for real: DuckDB `Catalog Error` because the referenced view was never built — proves live execution, not a stub | expected same                        | Not a bug; `dbt.show` needs the target relation to exist (`dbt build`/`run` first), same as any warehouse.                                                                                                                                                |
| `dbt.getProjectInfo`                               | advertised, project metadata              | `ok`, accurate (`models_count:2`, `is_estimate:false`, `adapter_type:"duckdb"`)                                           | expected `ok`                        | —                                                                                                                                                                                                                                                         |

No product bug was found. Every parity gap that could be attributed lands in the harness (fixed) or is
unresolved and needs further, targeted investigation (`dbt.listNodes`/`getCurrentNode`, rename's empty edit,
the since-cursor diagnostic timing) before it can be assigned to product code or accepted as a Fusion 2.0.5
server limitation.
