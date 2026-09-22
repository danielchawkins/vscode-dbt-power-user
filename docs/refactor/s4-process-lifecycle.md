# S4: dbt Fusion LSP process lifecycle

Captured 2026-09-21 on dbt Fusion 2.0.5, resolved from `PATH`, on Darwin arm64. Each run used a temporary copy of `src/test/fixtures/single-project` with that copy's dummy Snowflake profile as the only profiles source. There was no warehouse, no `dbt login`, and no `dbt deps`. The client listened on `127.0.0.1`, passed the port to `dbt lsp --socket`, set `--project-dir` and `--profiles-dir` to the temp copy, and passed `--no-version-check`. It answered `window/workDoneProgress/create` with null. Pre-load sampling was n=1 per scenario. Idle socket-close disposal was observed three times (one single-process run and two members of the concurrent pair). Idle `SIGTERM` was n=1. Within the single script invocation the one-process case ran first; the two-process and SIGTERM cases followed, so those later spawns likely reused a warm binary on disk but this capture does not isolate cold from warm.

These numbers describe the **single-project fixture only**, not a Consumer Repository-sized project. Every timing and RSS sample below is a **pre-load handshake** value: the client had sent `initialize` and received its response, but had not yet sent the `initialized` notification or any `textDocument/didOpen`. They do not describe a loaded project and do not inform the loaded-project lazy-versus-eager decision.

## Definitions

**Pre-load startup time** is elapsed milliseconds from spawning `dbt lsp` until the LSP `initialize` response arrives, before `initialized` or `didOpen`.

**Pre-load resident memory (RSS)** is the process RSS in KiB from `ps -o rss=` immediately after that `initialize` response, before `initialized` or `didOpen`.

**Idle socket-close exit** is whether a handshake-complete, idle server with no load or request in flight is gone within five seconds after the client destroys the TCP socket without sending `shutdown` or `exit`. Handshake-complete means the `initialize` response was received; the `initialized` notification was not sent.

**Idle SIGTERM exit** is elapsed milliseconds from `SIGTERM` on a still-connected, handshake-complete, idle server until process exit. Handshake-complete means the `initialize` response was received; the `initialized` notification was not sent.

## One process (n=1, pre-load handshake)

| Metric                                 | Value                |
| -------------------------------------- | -------------------- |
| Pre-load startup (`initialize` result) | 89 ms                |
| Pre-load RSS after `initialize`        | 54 128 KiB (~53 MiB) |
| Idle socket close exits within 5 s     | yes (exit code 0)    |

## Two concurrent processes (n=1, pre-load handshake)

Two temp copies, each with its own reverse socket and client, started in parallel.

| Metric                                 | Process A  | Process B  |
| -------------------------------------- | ---------- | ---------- |
| Pre-load startup (`initialize` result) | 120 ms     | 107 ms     |
| Pre-load RSS after `initialize`        | 54 304 KiB | 54 304 KiB |

Combined pre-load RSS is the arithmetic sum of the two per-process samples taken at each process's own `initialize` response (108 608 KiB, ~106 MiB), not a simultaneous RSS reading of both processes. Maximum pre-load startup across the pair: 120 ms.

Both processes exited on idle socket close within the five-second bound (exit code 0).

## Idle disposal

Disposal was tested only on handshake-complete, idle servers with no project load and no LSP request in flight. Handshake-complete means the `initialize` response was received; the `initialized` notification was not sent.

After pre-load `initialize`, destroying the client socket alone was enough in all three idle socket-close observations (n=3): the server exited with code 0 within the five-second harness wait. No `SIGTERM` or `SIGKILL` was required in those scenarios.

On a separate run the socket stayed open and the client sent `SIGTERM` while connected and idle (n=1). The process exited in 3 ms with signal `SIGTERM`. `SIGKILL` was not used.

The harness used a 5000 ms wait after `SIGTERM` before escalating to `SIGKILL`. That interval was chosen headroom for cleanup, not an observed ceiling; the 3 ms exit did not approach it.

## Verdict

**S4 is partial.** Idle pre-load disposal on the fixture is evidence: socket close exits without a signal in three idle observations (n=3), and `SIGTERM` on a handshake-complete idle process exited in 3 ms (n=1). Post-load memory and startup, Consumer Repository scale, window reload orphans, disposal during load or an in-flight request, and an empirical `SIGTERM`-to-`SIGKILL` ceiling remain open. Step 5.3's open lifecycle questions remain; these numbers do not answer them.

## Not measured in this run

**Post-load memory and time-to-loaded.** RSS and startup after `initialized`, `didOpen`, and project analysis completion were not captured.

**Consumer Repository scale.** Pre-load memory and startup were not captured on a Consumer Repository or any other real project.

**Window reload orphans.** No VS Code or Cursor window was opened or reloaded.

**Disposal during load or an in-flight request.** Mid-load and mid-request socket close and `SIGTERM` were not tested.

**Empirical `SIGTERM`-to-`SIGKILL` ceiling.** No observation required `SIGKILL` or established how long a non-exiting process would run before one was needed.

## Cleanup

All temp project directories and the measurement script under `/tmp` were deleted. `pgrep -fl 'dbt lsp'` was empty before this document was written.
