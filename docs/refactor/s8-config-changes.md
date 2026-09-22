# S8: config-change behavior

Captured 2026-09-21 on dbt Fusion 2.0.5, the binary named in section 2.4. The result is inconclusive. The server never finished loading on this run, and none of the applied stimuli produced producer evidence afterward, so step 6.2 starts with observed compile-complete and restart refresh triggers only.

The project was a temporary copy of `src/test/fixtures/single-project` plus `models/plain.sql`, whose text is `select 1 as id`. The copy kept the fixture models `child.sql` and `broken_ref.sql`. Unlike the [S2 command inventory](lsp-commands.md) capture, this run also added `packages.yml`, a local package at `vendor/s8_local_pkg`, and a second local package at `vendor/s8_local_pkg2` used only for the lock rewrite. `dbt_project.yml` names profile `single_project`. The copy's `profiles.yml` was the only profiles source (`--profiles-dir` pointed at the copy). There was no warehouse and no `dbt login`. The trace was not kept, and no SQL was written down.

Before `dbt lsp` started, an initial `dbt deps` created a present, non-empty `package-lock.yml` in the temp copy.

The client listened on `127.0.0.1`, passed the port to `dbt lsp --socket`, and set `--project-dir` and `--profiles-dir` to the temp copy. `--no-version-check` was set. `initialize` declared `window.workDoneProgress`, `workspace.configuration`, `workspace.didChangeWatchedFiles.dynamicRegistration: true`, and `textDocument` capabilities including synchronization and `publishDiagnostics`. It answered `window/workDoneProgress/create` with null and `client/registerCapability` with null. After `initialized` it sent `textDocument/didOpen` for `models/child.sql`, `models/broken_ref.sql`, and `models/plain.sql`. It called `dbt.listNodes` with `[]`. It listened for `textDocument/publishDiagnostics`, `$/progress`, and `window/logMessage`.

## File watcher registration

After `initialized`, the server registered one watcher through `client/registerCapability`:

| Registration id                   | Method                            | Glob   |
| --------------------------------- | --------------------------------- | ------ |
| `default-dbt-file-system-watcher` | `workspace/didChangeWatchedFiles` | `**/*` |

Section 2.4 records `**/*.{sql,csv}` for this registration; the live capture shows `**/*`. For paths inside a workspace folder and not excluded by normal host watcher rules, a real host implementing this registration would send `workspace/didChangeWatchedFiles` for project-root files such as `dbt_project.yml` and `package-lock.yml`. That claim does not extend to an external profiles directory such as an operator `~/.dbt` layout; this capture used only `profiles.yml` inside the temp project copy supplied through `--profiles-dir`. Whether Fusion watches a launch-flag-supplied profiles path through its own internal watcher remains unsettled.

## Baseline load

Before any config stimulus, `dbt.listNodes` returned `null`. A `Computing Lineage` progress pair (`kind: begin` then `kind: end`) followed `dbt.listNodes` within one millisecond. No `Analyzing` or `Parsing` progress arrived within 90 seconds. `dbt.getProjectInfo` stayed at `models_count` 0 and `models_count_is_estimate` true for the whole baseline wait.

A shorter pre-check on the same fixture copy without `packages.yml` or vendor packages also failed to load within 30 seconds. The failed baseline therefore occurred both before and after the local-package additions; this run does not show that those additions caused the load failure.

The [S2 command inventory](lsp-commands.md) records two controls without `packages.yml` or a vendor tree. Its three-model session reached `Analyzing` and `Parsing` through `kind: end`; an earlier two-model run reached `models_count` 2 with `models_count_is_estimate` false. This run did neither. The cause of the failed baseline is unknown.

During the baseline window, three `window/logMessage` notifications arrived, all type `Log` with the form `Did open: file://<redacted>` for the three opened model URIs. No other baseline log lines were recorded. Observations below are from a server that had not finished loading.

## Stimuli and observations

Each stimulus below was followed by a bounded wait of up to 20 seconds for the next `$/progress`, `textDocument/publishDiagnostics`, or `window/logMessage` notification, or for process exit. **Twenty seconds bounds only the absence of a next observable on this run; it does not establish time-to-correct results.**

For the two YAML edits, the client appended the exact bytes `\n# s8 neutral change\n`, re-read the file, and parsed it with the `yaml` package from `node_modules`. Validation succeeded in both cases. No second dbt CLI command was run before observing the LSP.

For the YAML paths, the client also sent `workspace/didChangeWatchedFiles` with change type `Changed`, matching what a host implementing the registered `**/*` watcher would send for paths inside the workspace folder.

| Stimulus                       | What was applied                                                                                                                                                                                                                                                                                                                                                                                                                                              | Server behavior after stimulus                                                                                                                            | Next observable within 20s |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `dbt_project.yml` neutral edit | Appended `\n# s8 neutral change\n`; YAML parse OK; `didChangeWatchedFiles` sent                                                                                                                                                                                                                                                                                                                                                                               | No reparse, restart, error, or qualifying log line. Process stayed alive. `dbt.getProjectInfo` unchanged.                                                 | None                       |
| `profiles.yml` neutral edit    | Same bytes and validation; `didChangeWatchedFiles` sent. File lives in the temp copy supplied through `--profiles-dir`, not an external operator profiles directory.                                                                                                                                                                                                                                                                                          | Same as above.                                                                                                                                            | None                       |
| `package-lock.yml` rewrite     | With the server running and the lock already present and non-empty, the client appended a second local package entry (`vendor/s8_local_pkg2`) to `packages.yml` and ran `dbt deps`. The existing lock stayed present and non-empty, and its content hash changed. The client then sent `didChangeWatchedFiles` with change type `Changed` for `package-lock.yml`; it did not send the notification a real host would also emit for the `packages.yml` change. | `dbt deps` exited 0. The server emitted no progress, diagnostics, or qualifying log line afterward. Process stayed alive. `dbt.getProjectInfo` unchanged. | None                       |

A bump to the first local package's version alone did not change an existing lock on a separate offline check; adding the second local package entry did. The rewrite row above used that second-package change.

## Producer evidence and step 6.2

Step 6.2 advances the publication epoch when the LSP producer completes and publishes a projection or restarts. It does not advance merely because a file changed on disk.

This capture observed no producer evidence for any applied change class on an unloaded server. There was no second `Analyzing` or `Parsing` progress after a config edit or after the existing `package-lock.yml` was rewritten, no `publishDiagnostics`, no qualifying log line beyond the baseline `Did open` messages, no process exit and reconnect, and no change in `dbt.getProjectInfo` that would mark a new published projection. The only progress before stimuli was the immediate `Computing Lineage` pair that followed `dbt.listNodes`.

**S8 remains inconclusive.** Step 6.2 must not claim that every change class republishes until a loaded server observes republication or restart for these stimuli, or their absence is confirmed after loading.
