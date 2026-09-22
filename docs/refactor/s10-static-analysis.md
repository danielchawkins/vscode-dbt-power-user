# S10: static-analysis mode

Captured 2026-09-22 on dbt Fusion 2.0.5. The operator opted in to profile `finance_general`, target `dev`, through the profiles directory under the home `.dbt` folder. No other profile or target was used. There is no login arm.

The result is inconclusive for mode comparison. `dbt parse` on the synthetic fixture succeeded, but neither `baseline` nor `strict` finished project load within five minutes per mode, so diagnostic, hover, and effective-mode measurements did not run against a loaded project. Follow-up diagnosis on 2026-09-22 tested Fusion 2.0.5 and 2.0.6 with short direct harness runs and a valid official-extension control; no loaded-project state was reproduced during that diagnosis window. What changed since earlier green captures on the same machine remains unknown.

## Method

The fixture is a minimal synthetic temp project, not a real or production project. It contains `dbt_project.yml` naming profile `finance_general`, three models under `models/`: one valid plain select, one base select with a numeric column and a text column, and one downstream model that adds those two columns through a `ref`. The type-addition case is intended to exercise schema/type diagnostics in `strict` once the project loads. Fixture SQL is not retained here.

Before each LSP run, `dbt parse` ran on a fresh temp copy with `--profiles-dir` pointing at the operator profiles directory, `--profile finance_general`, `--target dev`, and `--no-version-check`. Parse finished successfully in about 520 ms. Parse output named the profiles file and target only; no credentials or warehouse identifiers were recorded.

Each mode used a separate temp copy and process. Launch arguments matched except for `--static-analysis baseline` or `--static-analysis strict`. The client listened on `127.0.0.1`, passed the port to `--socket`, answered `window/workDoneProgress/create`, `workspace/configuration`, and `client/registerCapability`, and declared `window.workDoneProgress`, `workspace.configuration`, `workspace.didChangeWatchedFiles` dynamic registration, and `textDocument` synchronization, hover, and publishDiagnostics. After `initialized`, the client opened the root manifest and all three models, called `dbt.listNodes` once analysis was expected to start, polled `dbt.getProjectInfo` every two seconds for up to five minutes, then requested hover on a column identifier in the plain model. Diagnostics were collected from `textDocument/publishDiagnostics` only; neither mode advertised `diagnosticProvider` at `initialize`, so pull diagnostics were not queried.

Invalid `--static-analysis not-a-mode` still exits before launch with `invalid value 'not-a-mode'` and lists `off`, `strict`, and `baseline`. The flag is parsed at the CLI.

## Load proof

A mode is valid for comparison only after an Analyzing `$/progress` `kind: end` or `dbt.getProjectInfo` returns `models_count_is_estimate: false` with the expected model count of three. Neither mode met that bar.

| Mode     | Analyzing begin | Analyzing end | Final `models_count` | `models_count_is_estimate` | `publishDiagnostics` |
| -------- | --------------- | ------------- | -------------------- | -------------------------- | -------------------- |
| baseline | none observed   | none          | 0                    | true                       | none                 |
| strict   | none observed   | none          | 0                    | true                       | none                 |

Both modes returned `adapter_type: snowflake` from `dbt.getProjectInfo` throughout the wait. The only progress observed after `dbt.listNodes` was Computing Lineage begin and immediate end, with message "Waiting for compilation to complete...". A separate run that called `dbt.getCurrentNode` instead recorded Getting Columns begin and immediate end with the same compilation-wait message. No Parsing reports appeared. Compilation never completed from the client's perspective.

Because neither server loaded, equality of capabilities or empty hover results is not evidence that the modes behave the same under load.

## Timings

Spawn-to-initialize spans connect, send `initialize`, and receive the result. First diagnostic and meaningful hover timings are null when the project never loaded; hover was still requested after the five-minute poll.

| Metric                         | baseline | strict |
| ------------------------------ | -------- | ------ |
| Spawn to `initialize` result   | 34 ms    | 562 ms |
| Spawn to Analyzing end         | —        | —      |
| First diagnostic               | —        | —      |
| First hover (after 5 min poll) | empty    | empty  |
| Hover content class            | empty    | empty  |

The initialize latency gap is cold-start variance on the same machine, not a documented mode difference. Analyzing-end and diagnostic columns are em dashes because load never completed.

## Capabilities and commands at `initialize`

Both modes returned the same capability keys: `codeActionProvider`, `codeLensProvider`, `completionProvider`, `definitionProvider`, `documentFormattingProvider`, `documentSymbolProvider`, `executeCommandProvider`, `hoverProvider`, `inlayHintProvider`, `referencesProvider`, `renameProvider`, `semanticTokensProvider`, `signatureHelpProvider`, `textDocumentSync`, and `workspace`. `diagnosticProvider` was absent in both. The seven advertised commands matched: `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`, and `dbt.show`.

No server log field, progress title, or capability advertised an effective static-analysis mode. Configured mode is known only from the launch argument. Effective mode cannot be inferred from behavior because compilation did not finish in either mode.

## Observable mode differences

With the project unloaded, no behavioral difference between `baseline` and `strict` was observed for diagnostics, hover, progress sequence, or initialize capabilities. That is not a conclusive "no difference" verdict: the type-addition fixture and hover on a column identifier were chosen to exercise schema/type features expected to diverge in `strict`, but those code paths never ran.

## Limitations

- The warehouse reachable through `finance_general` / `dev` may block or stall LSP compilation even when CLI `dbt parse` succeeds on the same fixture and profile. This capture does not isolate whether warehouse connectivity, profile permissions, or a Fusion LSP defect caused the stall.
- Diagnostics may require a loaded project; with no `diagnosticProvider` at initialize and no push notifications, absence of diagnostics is inconclusive.
- A prior capture on 2026-09-21 using an incomplete client also failed to load; this rerun used the full client contract above and still failed to load with the operator profile.
- No query text, result rows, query ids, credentials, account identifiers, or document bodies were retained. Isolated user-data, extensions, and workspace directories used for diagnosis were removed, along with spawned processes. The temporary direct harness was deleted after capture and was not preserved in the repository; the method and tested variants are recorded below for a later rerun.

## Diagnosis (2026-09-22)

After the inconclusive baseline/strict capture, short direct harness runs and a valid official-extension control were run to narrow whether a client defect, profile resolution, or Fusion/version change blocked load.

### Historical green evidence (prior captures)

Earlier captures on this machine recorded loaded-project behavior on Fusion 2.0.5 with the S2 dummy fixture:

- `docs/refactor/lsp-commands.md` recorded Analyzing `$/progress` through Parsing reports and `kind: end` on the single-project copy with the fixture dummy Snowflake profile. On an earlier two-model run, after that analyzing progress ended, `dbt.getProjectInfo` returned `models_count` 2 and `models_count_is_estimate` false.
- ADR 0005 references the same S2 inventory reaching Analyzing end and `models_count` 2 on the dummy profile, and contrasts it with later four-row runs that did not finish loading.

The 2026-09-22 diagnosis did **not** reproduce those green outcomes on Fusion 2.0.5 or on 2.0.6. The S7 and S8 captures from the same migration window also failed to load their projects, which corroborates a current machine-wide regression but does not identify what changed from the historical green run.

### Fusion 2.0.6 provenance

Fusion 2.0.6 was acquired through the `aqua:getdbt.com/dbt-fusion` tool registry for diagnosis only; repository pins were not changed. Version was verified by running the binary's `--version` output. The official extension control used `dbtLabsInc.dbt@0.107.8`, whose manifest records `lspVersion: 2.0.6`.

### Direct harness (no VS Code)

The harness listens on `127.0.0.1`, passes the port to `--socket`, runs `dbt parse` first, opens fixture models, and polls `dbt.getProjectInfo` until Analyzing `$/progress` `kind: end` or `models_count_is_estimate: false`. Exit code 0 means green; exit code 1 means red. These runs used a **45-second** wait. They are short differential reproductions only; they are **not** equivalent to the five-minute load bar used for the baseline/strict mode capture above and do not erase the historical green data.

| Binary | Fixture              | Profile / target        | Result (45 s differential) | Final `models_count` | `models_count_is_estimate` | Analyzing progress |
| ------ | -------------------- | ----------------------- | -------------------------- | -------------------- | -------------------------- | ------------------ |
| 2.0.5  | S2 single-project    | `single_project` / test | red ×2                     | 0                    | true                       | none               |
| 2.0.6  | S2 single-project    | `single_project` / test | red ×2                     | 0                    | true                       | none               |
| 2.0.5  | synthetic (original) | `finance_general` / dev | red                        | 0                    | true                       | none               |
| 2.0.6  | synthetic (original) | `finance_general` / dev | red                        | 0                    | true                       | none               |

Harness launch shape: `dbt lsp --socket <port> --project-dir <tmp> --profiles-dir <fixture-or-home> --no-version-check --profile … --target …` plus optional `--static-analysis`. Variants tried without changing the 45-second outcome included minimal versus full client capabilities, empty versus dbt-lsp configuration responses, `--compute inline`, `DBT_COMPUTE=inline`, `--no-manage-state`, opening all models, and post-init `dbt.getCurrentNode` / `dbt.listNodes`. None produced Analyzing begin/end or a non-estimate model count during those short runs.

Separate compatibility observation: standalone `dbt lsp --clientProcessId <pid>` on Fusion 2.0.5 and 2.0.6 exits with `unexpected argument '--clientProcessId' found`. No verbatim process argv from the official extension session was retained, so that flag was not recorded as part of the official launch.

### Official extension control (activation and startup; load confounded)

An earlier control used `--disable-extensions`, which suppresses installed VSIXes; `--enable-extension` did not restore `dbtLabsInc.dbt` in exthost logs and could not answer the question. The valid control below does **not** pass `--disable-extensions`.

Setup:

- Isolated `--user-data-dir`, `--extensions-dir`, and temp S2 workspace (in-project `profiles.yml`, dummy Snowflake profile).
- Installed `dbtLabsInc.dbt@0.107.8` into the isolated extensions directory; `cursor --list-extensions --show-versions` listed it.
- Pre-seeded isolated settings: `dbt.dbtPath` pointing at local Fusion 2.0.6, verbose LSP trace, workspace trust disabled, no sign-in and no Cloud enablement.
- Launched Cursor with the temp workspace open; built-in Cursor/VS Code extensions were allowed to run.

Activation proof (exthost log):

- Extension id: `dbtLabsInc.dbt`
- Activation event: `workspaceContains:**/dbt_project.yml,**/dbt_project.yaml`
- Outcome: `Extension activated success: dbtLabsInc.dbt — 2172ms` (no activation error)

Startup (not same-fixture load confirmation):

- No managed download; extension used configured `dbt.dbtPath` (Fusion 2.0.6 on disk).
- Extension log: `LSP startup complete. success=true`.
- LSP server log: connected on socket port 8000; server version `2.0.6`.
- Verbatim argv was not retained. Inferred launch shape (redacted): `dbt lsp --project-dir <workspace> --command-prefix <uuid>: --socket 8000` with env `DBT_LSP_USE_TARGET_LSP=1`.
- **Profile resolution confound:** official launch did not pass `--profiles-dir`. The LSP server log repeatedly recorded `Loading ~/.dbt/profiles.yml` for the full observation window instead of the workspace-local dummy profile file. This control therefore proves activation and LSP startup only. It is a separate unloaded run under operator profile resolution, not independent confirmation of the direct dummy-profile failure on the same fixture conditions.

Load observations (official extension, confounded):

| Signal                    | Result                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Analyzing `$/progress`    | none observed in LSP trace                                                                                            |
| Prefixed `getProjectInfo` | LSP trace shows the extension polling prefixed `dbt.getProjectInfo`; responses were empty and unusable for load proof |
| Managed LSP log tail      | repeated operator-profile reloads, no Analyzing line                                                                  |

S2 prior work already showed prefixed command responses may be `{}` independent of load; `{}` is not treated here as a schema-failure signal.

### Diagnosis conclusion

The 2026-09-22 diagnosis produced **no reproducible loaded control** within its observation windows. Root cause remains unknown among environment change, profile resolution, and Fusion LSP behavior. Bumping the product minimum to 2.0.6 alone is unsupported by the direct short control and did not help there. S10 remains **inconclusive** for baseline-versus-strict comparison on a loaded project.
