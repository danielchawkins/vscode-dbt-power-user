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

## Gate status

**5.6 remains blocked.**

- S10 loaded-project control absent on production-shaped arms A/B.
- Provider deletion **not** recommended: most 5.6 flows fail even after arm C's `compileLsp` trigger; arm C depends on non-production execute commands and prefix.
- Do not treat prefixed `getProjectInfo` `object` shape as loaded-project proof.
