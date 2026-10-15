# Official dbt extension 0.117.0 against Fusion Power User

The official dbt Labs extension (`dbtlabsinc.dbt` 0.117.0, released 2026-10-15) and this extension both drive the same Fusion binary. This note compares how each one calls it and lists what is worth copying. The rule for every recommendation is that the extension must keep working with no dbt Cloud account, hosted service, login or telemetry.

Five read-only research runs (`20261015T0934*`) produced the comparison. The official extension ships as one minified bundle, so its line numbers refer to a beautified copy (`js-beautify -s 2 -w 140` of `dist/extension.js`); the research runs could not cite it, and the claims below that the recommendations depend on were checked against it by hand.

## Already better here, keep

- **Crash restarts are bounded.** This extension retries an unexpected exit three times with backoff; the official one returns `Restart` from its `closed` handler on every exit.
- **The language server port comes from the OS.** This extension listens on `127.0.0.1:0` and the server connects back; the official one scans ports 8000 to 8099.
- **Requests have deadlines and cancellation.** `compileFile`, `getCurrentNode` and `listNodes` have a 5 s deadline, run on per-class queues and retry once after a cancellation.
- **CLI runs report real exit codes.** The official extension's silent CLI path always reports exit code 0.
- **CLI runs are queued per project**, one at a time, and their arguments are covered by `cliArgs.test.ts` and `cliArgs.property.test.ts`.
- **Previews run on the CLI.** ADR 0007 keeps `dbt show` off the language server because a long query blocks the server's other requests.

## Recommendations

| # | Change                                                                                                                                                                                                                                                                         | Effort | Risk   |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------ |
| 1 | Put a timeout (15 s) on the `dbt --version` probe. `defaultRunVersion` calls `execFileText` with none, so a hung binary stalls setup.                                                                                                                                          | S      | Low    |
| 2 | Accept prerelease and build suffixes in the version banner (`dbt 2.0.6-preview.3 (a1b2c3d …)`) and the legacy `dbt-fusion X.Y.Z`, so an old build reports "too old" rather than "not Fusion". The official extension has a second, tolerant parser for this.                   | S      | Medium |
| 3 | Set `RUST_MIN_STACK_SIZE=8388608` for CLI child processes, as the official extension does for its tasks, unless the project environment already sets it.                                                                                                                       | S      | Low    |
| 4 | Add `show` to the commands that take defer flags. The official extension defers `compile, build, parse, run, run-operation, seed, show, snapshot, test`; this one defers only run, build, test and compile, so a preview with defer on cannot resolve unbuilt upstream models. | S      | Medium |
| 5 | Pass `--log-level-file` with `--log-level`, so the server's log file follows the chosen level. It writes a local file.                                                                                                                                                         | S      | Low    |
| 6 | Probe `dbt lsp --help` before the first launch and report a binary without the `lsp` subcommand as a configuration error.                                                                                                                                                      | S      | Low    |
| 7 | Answer `lsp.maxErrorReporting` in `workspace/configuration`, behind a new setting. Today the answer carries only the linter flag.                                                                                                                                              | S      | Low    |
| 8 | Add lint-fix (code action `source.fixAll.dbtLintFix`) and format on save, if the pinned Fusion advertises them.                                                                                                                                                                | M      | Medium |
| 9 | Document the defaults that differ: lint is on here and off there; the query limit is 500 against 1000; tracing is off against verbose; defer is off unless configured against on.                                                                                              | S      | Low    |

Defer stays opt-in: changing the default would change every user's results.

## Considered and not recommended

- **Parsing `.env` into the environment.** The official extension merges the project `.env` itself; ADR 0008 leaves it to Fusion, which loads it. Loading it twice could change precedence.
- **A plain environment-variable map setting.** The mise or direnv overlay already covers the project environment; reconsider only if a user needs a variable from neither.
- **A login-shell `PATH` capture and a list of known install directories.** Both would find Homebrew or asdf `dbt` from a GUI-launched editor, but spawning a shell is outside ADR 0008.
- **Including `.md` in the document selector.** Only worth it if Fusion answers requests for Markdown docs files.
- **Recursive project discovery.** ADR 0003 rules it out; the official extension's workspace-wide search is a trade-off, not a defect.

## Not applicable

These depend on dbt Cloud, a login, licensing or telemetry, or on installing dbt: the OpenTelemetry file export (`--otel-file-name`), the telemetry middleware, `DBT_CLIENT_VERSION`, dbt State and platform auto-defer, `compare`, `license info`, sign-in, binary install and update, `get-distribution-info` inventory, and the v1 migration onboarding.

## Not verified

No extension was run; every finding comes from reading code. The language server's handling of `lsp.maxErrorReporting` and `dbt/progress` payloads, and whether Fusion reads `RUST_MIN_STACK_SIZE`, need a live check before the matching change.
