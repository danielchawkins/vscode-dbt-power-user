# S7: target mutation

**Verdict: partial.** A reproducible capture on dbt Fusion 2.0.5 with the production launch shape, a parse-clean dummy fixture, 250 ms interval snapshots, an edit/save session, server-phase watcher measurement, and `n=2` independent `dbt.clearTarget` trials shows that `dbt.compileLsp` writes under `target/compiled/**`, that `target/manifest.json` never appeared in this session, and that `dbt.clearTarget` deletes real server-written compiled artifacts plus a harness sentinel. That measures compile writes and clearTarget destructiveness on this fixture. It does not discharge duplicate extension-initiated work, Consumer Repository-scale watcher rates, or retirement of the ambient adapter watcher on clearTarget destructiveness alone.

Captured 2026-09-22 on dbt Fusion 2.0.5 with `--no-version-check`. The harness snapshots baseline `target/` on the checked-in source fixture root, then copies to a temp directory and removes `models/child.sql` and `models/broken_ref.sql` and adds `models/plain.sql` through the fixture `prepareProject` hook. No terminal `dbt parse` runs after the baseline snapshot. The copy's dummy Snowflake profile is the only profiles source. There was no warehouse and no `dbt login`. The spawned process inherits the harness environment; `--target-path` was unset and the fixture `dbt_project.yml` names no alternate target path, so observed writes establish the effective target path as default `target/` for this run only.

Launch arguments match the production client except for `--command-prefix`, which the direct harness omits: `dbt lsp --socket <port> --project-dir <tmp> --profiles-dir <tmp> --no-version-check --lint-enabled true --static-analysis baseline`. The client listened on `127.0.0.1`, answered `window/workDoneProgress/create`, `workspace/configuration`, and `client/registerCapability`, and declared `window.workDoneProgress`, `workspace.configuration`, `workspace.didChangeWatchedFiles` dynamic registration, and `textDocument` synchronization, hover, and `publishDiagnostics`. Fusion 2.0.5 advertised `textDocumentSync: { change: 2, openClose: true, save: {} }` (numeric LSP kind 2 = incremental). The edit session sent `textDocument/didChange` with a text-only `contentChanges` entry and `textDocument/didSave`; the summary records that those notifications were sent and the phase progress/error counts observed, not a separate server recompile signal.

After `initialized` the client opened root `dbt_project.yml` and `models/plain.sql`, waited eight seconds with interval snapshots, sent the edit notifications above, called `dbt.listNodes`, called `dbt.compileLsp` twice to distinguish creates from content rewrites and mtime-only touches, took a **pre-clearTarget reference** snapshot, then ran two independent clearTarget trials: each trial reran `dbt.compileLsp`, asserted compiled artifacts existed, added a harness sentinel, called `dbt.clearTarget`, and asserted `target/`, compiled artifacts, and the sentinel were gone. Lineage progress used Computing Lineage begin titles and matched end notifications by progress token within each phase window. Analyzing progress used title/message only. **Analyzing `kind: end` was not used as load proof** for any verdict in this document.

Reproduce with `just test-integration --grep "S7 target mutation"`. The test prints a metadata-only `FPU_S7_CAPTURE=` JSON summary and leaves the checked-in fixture unchanged. Two consecutive local runs after the mutation-scoping fix reported identical watcher and mutation counts; `workDoneProgressCreateCount` was stable at 9 across both runs. `artifactMutations` and `phaseMutations` count only `SERVER_PHASES` snapshots (baseline through `compileLsp`); `pre-clearTarget-reference` and clearTarget trial snapshots are observational only and do not update mutation counters.

## Part one: target snapshots

Baseline on the source fixture root before temp copy and prepare: no `target/` directory, no `target/manifest.json`, no `target/compiled/**`.

| Phase                     | `target/` dir | `target/manifest.json` | `target/compiled/**` count | Notes                                                          |
| ------------------------- | ------------- | ---------------------- | -------------------------- | -------------------------------------------------------------- |
| baseline                  | absent        | absent                 | 0                          | source root before copy/prepare; no terminal parse             |
| idle-after-didOpen        | absent        | absent                 | 0                          | no `target/` in interval snapshots                             |
| edit-save                 | absent        | absent                 | 0                          | didChange and didSave sent; no target write                    |
| listNodes                 | absent        | absent                 | 0                          | lineage begin/end token-paired within phase                    |
| compileLsp (×2)           | present       | absent                 | 2                          | server created `target/`; phaseMutations.compileLsp: 2 creates |
| pre-clearTarget reference | present       | absent                 | 2                          | last server-artifact snapshot before trials                    |
| clearTarget trial (×2)    | absent        | absent                 | 0                          | each trial deleted real compiled artifacts                     |

Interval snapshots use a 250 ms floor between reads. Events shorter than that window may not appear as separate snapshot rows; the summary counts snapshot observations, not a continuous filesystem trace.

Transient paths compare server-phase observations (baseline through compileLsp) against the pre-clearTarget reference snapshot. **Outcome: none observed** (`transientPaths: []` in both repeated final runs).

**LSP command writes:** `dbt.compileLsp` wrote compiled artifacts (`artifactMutations`: two file creates, zero content rewrites, zero mtime-only touches on this fixture; all attributed to the `compileLsp` phase in `phaseMutations`). The second `compileLsp` call retained the same compiled hashes; no mtime-only touch was observed in server-phase snapshots. No phase observed `target/manifest.json`. Idle, edit/save, and `dbt.listNodes` alone did not add compiled files in this capture.

**`dbt.clearTarget` destructiveness:** conclusive on `n=2` independent trials. Each trial recreated compiled artifacts with `dbt.compileLsp`, added a sentinel, then `dbt.clearTarget` removed the sentinel, compiled files, and the `target/` directory.

## Part two: ambient watcher rate

The harness watches the project root until `target/` appears (attributing directory creation to the server), then attaches a non-recursive `fs.watch` on `target/` with a 300 ms trailing debounce matching the adapter shape. Nested compiled writes may occur before the target watcher attaches; counts therefore scope to observed target-level events only and may undercount nested activity. Watcher counts were collected only through idle, edit/save, listNodes, and compileLsp, then stopped and flushed before harness sentinel writes or clearTarget trials, so sentinel and mkdir events are excluded.

Two consecutive final captures reported identical server-attributable counts: `rawEvents: 1`, `settledBursts: 1`, `readAttempts: 1` (one read attempt per settled burst), and `targetCreatedByServer: true`. The harness answered nine stable `window/workDoneProgress/create` requests across both runs. No `target/manifest.json` appeared, so a tight-loop manifest **writer vulnerability** probe was not applicable (`manifestWriterVulnerability: not_applicable`).

Those numbers characterize this fixture only (`watcherRateScope: single-project-dummy-server-phases-only`). They are not Consumer Repository-scale race rates. The adapter's non-recursive target watcher would not observe nested compiled-file writes directly; ambient republication from stale or duplicated reads remains a separate retirement question from clearTarget destructiveness alone.

## Harness noise

Harness errors were recorded for unanswered `workspace/codeLens/refresh` and `workspace/semanticTokens/refresh` server requests. They did not affect target snapshots. No SQL, document bodies, credentials, or stderr payload text were retained.

## Decisions

| Question                                  | Answer                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does `dbt lsp` write `target/` artifacts? | Yes for `target/compiled/**` via `dbt.compileLsp` on this fixture; `target/manifest.json` not observed here                                                                              |
| Is `dbt.clearTarget` destructive?         | Yes — deletes server-written compiled artifacts and the whole temp `target/` directory; confirmed on two independent trials                                                              |
| Step 7.1 evidence discharged?             | Partial only (`step71Verdict: partial`) — compile writes and clearTarget destructiveness measured; duplicate-work, nested-write blind spots, and large-project watcher rates remain open |

## Open questions for step 7.1

- Whether `target/manifest.json` appears on other fixtures or after a terminal `dbt parse` seed when the same command sequence runs.
- Settled-burst read counts per command class on a Consumer Repository-sized project.
- Whether duplicate extension-initiated work exists once a loaded editing session runs at realistic command spacing.
- Whether non-recursive target watching misses nested compiled writes often enough to cause stale ambient republication.

The prior 2026-09-21 inconclusive idle capture is superseded for compile writes and clearTarget behavior by this reproducible harness run. Retiring the ambient target watcher at step 7.1 remains sequenced; clearTarget destructiveness alone does not prove retirement is safe — the stronger arguments are command-scoped artifact use, non-recursive watching missing nested compiled writes, and the ambient duplication/staleness risk the adapter's debounced manifest reads introduce when external writers also touch `target/`.
