# Pass through dependency diagnostics until a regression exists

**Status:** D3 decided: pass standard Fusion diagnostics through unchanged. The 2026-09-22 S1 rerun established a parse-clean control but observed no positive loaded-project probe and no `textDocument/publishDiagnostics`; it therefore found no harmful dependency noise that would justify filtering or a synthetic project blocker. Add either only with a production-shaped regression.

Captured 2026-09-22 on dbt Fusion 2.0.5 with the merged `LspFixture` / `LspProtocolClient` harness in `src/test/integration/s1DependencyDiagnosticsCapture.test.ts`. The suite is opt-in: `FPU_RUN_S1_CAPTURE=1 just test-integration --grep "S1 dependency diagnostics capture"`. Default `just test-integration` skips it. Each arm used a fresh temporary copy of `src/test/fixtures/single-project` with the inherited `child.sql` / `broken_ref.sql` chain removed. The dummy Snowflake profile in the copy was the only profiles source. There was no warehouse and no `dbt login`.

## Launch argv

The harness recorded the argv passed to `dbt` at connect (redacted):

```text
lsp --socket <port> --project-dir <project> --profiles-dir <project> --no-version-check --lint-enabled true --static-analysis baseline
```

Production `buildFusionLspArgs` also supplies `--command-prefix <prefix>` and optional `--target` / `--log-level`; this capture used bare `dbt.*` commands and did not pass a command prefix.

## Client contract

`initialize` declared `window.workDoneProgress`, `workspace.configuration`, `workspace.didChangeWatchedFiles.dynamicRegistration`, and `textDocument` synchronization (including `willSave` / `didSave`), `publishDiagnostics`, completion, hover, signature help, definition, references, document highlight, document symbol, formatting, rename, code action, code lens, and inlay hint. The client answered `window/workDoneProgress/create` and `client/registerCapability`. No `workspace/configuration` server request arrived on any arm.

After `initialized`, each arm opened the files named in the table below from prepared content (no post-open full-text replacement). Control additionally opened an unsaved buffer containing an incomplete `ref(` for the completion probe. Each arm called `dbt.listNodes` once as an optional observation trigger. The capture did not call `dbt.clearTarget` and did not treat Analyzing `$/progress` `kind: end` as load proof.

Observation waited up to 90 seconds for the first `textDocument/publishDiagnostics`. When none arrived, the full bounded window elapsed (~90 s). When a diagnostic arrived first, the client slept once for five seconds to collect additional URIs. Connection or protocol errors during observation ended the arm without waiting out the remaining window. The client also sent `textDocument/diagnostic` pull requests even though `diagnosticProvider` was absent from `initialize` on every arm.

Package source for local packages was placed at `<temp>/pkg-source/<name>`, outside the project root, with `packages.yml` referencing `../pkg-source/<name>`. On control and dependency-model arms where `dbt deps` succeeded, the installed package canonical path resolved to the source tree (symlink/copy), distinguishable from the lexical `dbt_packages/` path.

## Preflight and opened files

| Arm                          | `dbt deps` | `dbt parse` | Preflight oracle                          | Opened files (relative to project root)                                                                                                                          |
| ---------------------------- | ---------- | ----------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Control (n=2)                | 0          | 0           | none                                      | `dbt_project.yml`, `packages.yml`, `models/base.sql`, `models/child_model.sql`, installed package model; plus unsaved incomplete-ref buffer for completion probe |
| Root metadata error          | 1          | 1           | `SerializationError (dbt1013)` on root    | `dbt_project.yml`, `packages.yml`, `models/base.sql`, `models/child_model.sql`                                                                                   |
| Dependency model error (n=2) | 0          | 1           | `DependencyNotFound (dbt1048)` in package | above plus `dbt_packages/err_pkg/models/bad_pkg.sql`                                                                                                             |
| Broken dependency manifest   | 1          | 1           | `SerializationError (dbt1013)` in package | root files above plus `<pkg-source>/broken_pkg/dbt_project.yml` (opened and pulled; no `dbt_packages/` path)                                                     |

The root metadata arm uses invalid root `dbt_project.yml` YAML as an independent preflight oracle. LSP `initialize` succeeded on that arm; no root `dbt_project.yml` push diagnostic arrived within the observation window.

## Control load probes (n=2)

Non-control arms record `loadProbes: not-probed`.

| Probe                                                 | Run 1 outcome | Run 1 detail                   | Run 2 outcome | Run 2 detail                   |
| ----------------------------------------------------- | ------------- | ------------------------------ | ------------- | ------------------------------ |
| `dbt.getProjectInfo`                                  | null          | `models_count=0,estimate=true` | null          | `models_count=0,estimate=true` |
| `textDocument/completion` (unsaved incomplete `ref(`) | null          | `null-result`                  | null          | `null-result`                  |
| `textDocument/definition` (on `ref('base')`)          | null          | `null-result`                  | null          | `null-result`                  |

Positive load requires a probe outcome of `success` (for completion, an item whose label is exactly `base`). None met that bar within 30 seconds per probe.

## Observations

| Arm                          | Load probes | `publishDiagnostics` | Pull `textDocument/diagnostic`                  | `$/progress` post `listNodes` | Harness errors |
| ---------------------------- | ----------- | -------------------- | ----------------------------------------------- | ----------------------------- | -------------- |
| Control (n=2)                | see above   | none                 | success, `items=0` (root model)                 | Computing Lineage begin + end | none           |
| Root metadata error          | not probed  | none                 | success, `items=0` (root manifest)              | Computing Lineage begin + end | none           |
| Dependency model error (n=2) | not probed  | none                 | success, `items=0` (installed dependency model) | Computing Lineage begin + end | none           |
| Broken dependency manifest   | not probed  | none                 | success, `items=0` (external source manifest)   | Computing Lineage begin + end | none           |

`initialize` advertised the same capability keys on every arm, including `executeCommandProvider`, and did **not** advertise `diagnosticProvider`. The server registered `default-dbt-file-system-watcher` for `workspace/didChangeWatchedFiles` with glob `**/*`. Server requests captured: `client/registerCapability`, `window/workDoneProgress/create`. No qualifying stderr lines were retained.

## Verdict

The capture emits a structured D3 verdict that cannot invert filtering from blocker need:

```json
{
  "status": "provisional" | "decided",
  "policy": "confinement" | "filter",
  "fusionRootBlocker": boolean,
  "syntheticBlocker": boolean,
  "reason": string
}
```

When `status` is `decided`, `policy: "confinement"` means implement nothing — Fusion already confines dependency failures to the root project (root-side dependency-failure evidence on dependency-model or broken-manifest arms, zero dependency-URI diagnostics; the root-metadata oracle arm is excluded). `policy: "filter"` is selected when dependency-URI diagnostics are present; `fusionRootBlocker` records whether Fusion already published an exact root `dbt_project.yml` diagnostic whose message class is dependency-related (`dependency-not-found` or `yaml-serialization`, excluding unrelated root lint); `syntheticBlocker` is `!fusionRootBlocker` when filtering applies.

The capture result remains provisional (`status: "provisional"`, `reason: "control load probes did not reach success"`); the policy decision does not reinterpret it. With no observed dependency diagnostics, filtering would be speculative and could hide useful server output. Step 5.5 therefore implements no middleware. A later production-shaped regression may reopen D3 with concrete URIs and messages.
