# S7: target mutation

**Verdict: part one is inconclusive.** The project did not finish loading within the wait. This session observed no writes to `target/manifest.json` or `target/compiled/**`, but that observation does not discharge the S7 evidence step 7.1 needs.

Captured 2026-09-21 on dbt Fusion 2.0.5, the binary named in section 2.4, with `--no-version-check`. The project was a temporary copy of `src/test/fixtures/single-project`. `models/child.sql` and `models/broken_ref.sql` were removed and `models/plain.sql` was added, matching the S1 fixture layout in `docs/adr/0005-dependency-diagnostics.md`. The copy's dummy Snowflake profile was the only profiles source. There was no warehouse and no `dbt login`. No terminal dbt command ran during the session except the `dbt lsp` process.

The client listened on `127.0.0.1`, passed an ephemeral port to `dbt lsp --socket`, and set `--project-dir` and `--profiles-dir` to the temp copy. `--target-path` was unset. The fixture `dbt_project.yml` has no `target-path` setting. The capture transcript records those launch arguments but does not record the spawned process environment, so `DBT_*` overrides were not verified and writes outside the default `target/` path are not excluded.

The client `initialize` declared `window.workDoneProgress`, `workspace.configuration`, and `textDocument` capabilities including synchronization and `publishDiagnostics`. It answered `window/workDoneProgress/create` with null. After `initialized` it sent `textDocument/didOpen` for root `dbt_project.yml` and `models/plain.sql`. It did not send `textDocument/didChange` or a save notification, so this was not the fixed editing session the spike describes. It listened for `$/progress`. The session then waited 60 seconds with no further client messages, called `dbt.getProjectInfo` with `[]`, closed the socket, and sent `SIGTERM` to the server.

## Part one: target snapshots

The fixture has no `target/` directory. Snapshots covered `target/manifest.json` and `target/compiled/**` only before launch and after the wait; there were no interval snapshots, so a transient write and delete within the window would not appear. Before launch the snapshot was empty. After the 60-second wait it was still empty: no `target/` directory was created and no watched paths appeared.

| Phase  | `target/manifest.json` | `target/compiled/**` |
| ------ | ---------------------- | -------------------- |
| Before | absent                 | absent               |
| After  | absent                 | absent               |

No `$/progress` message with `kind: end` arrived during the wait. No begin messages were retained. `dbt.getProjectInfo` returned `models_count` 0 and `models_count_is_estimate` true. This matches the S1 control row on the same fixture layout: the project did not finish loading within the wait.

`docs/refactor/lsp-commands.md` records two separate observations on other layouts. One run kept `broken_ref`, `child`, and `plain` and reached Analyzing `kind: end`. An earlier run of only the two fixture models returned `models_count` 2 after analyzing progress ended. Those are not one loaded-session control, and neither matches this capture's layout.

## Part two: ambient watcher rate

Not measured. Part one did not produce a target write to measure against, so the trigger condition for part two was not met. That is not evidence that the server does not write artifacts. The non-recursive `fs.watch` registration with 300 ms debounce and settled-burst counts were not run. No writer-vulnerability or race-rate number is reported.

## Open questions for step 7.1

- Whether `dbt lsp` writes `target/manifest.json` or `target/compiled/**` when analysis completes on a fixture that reaches Analyzing `kind: end`.
- Whether extension-initiated commands that await completion write artifacts the ambient watcher would observe.
- Settled-burst read counts per command class and project size, once part one produces a write to measure against.
- Whether duplicate extension-initiated work exists, which gates the deduplication layer step 6.0 defers.

This capture does not discharge the S7 evidence step 7.1 needs. A conclusive rerun requires a fixture and session that reaches Analyzing `kind: end`, records the spawned environment if target-path assumptions matter, and follows the spike's fixed editing session and interval snapshot protocol.
