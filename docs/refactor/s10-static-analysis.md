# S10: static-analysis mode

Captured 2026-09-21 on dbt Fusion 2.0.5, the binary named in section 2.4. The result is inconclusive. `baseline` and `strict` produced no observable that could differ, so this run does not discharge the measurement step 5.0 waits on.

The project was a temporary copy of `src/test/fixtures/single-project` plus `models/plain.sql`, whose text is `select 1 as id`. `dbt_project.yml` names profile `single_project`. The launch overrode that with `--profiles-dir` set to the operator's profiles directory, `--profile finance_general`, and `--target dev`, so the copy's own `profiles.yml` was not on the resolution path. One process used `--static-analysis baseline` and one used `--static-analysis strict`. `--no-version-check` was set. The log level was the server default. The trace was not kept, and no SQL was written down.

`dbt lsp --static-analysis not-a-mode` exits before launch with `invalid value 'not-a-mode'` and lists `off`, `strict`, and `baseline`. The flag is parsed. That check does not show the two launched servers applied different modes.

The client listened on `127.0.0.1` and passed the port to `--socket`. Its `initialize` capabilities were `window.workDoneProgress` and `workspace.configuration`. It did not declare `textDocument` capabilities. After `initialize` it sent `initialized`, then `textDocument/didOpen` for `models/plain.sql`. It answered `window/workDoneProgress/create` with null. It listened for `textDocument/publishDiagnostics`. It then called `textDocument/hover` at line 0, character 10 of `select 1 as id`, which is the `s` in `as`, not the identifier `id`. It then called `dbt.getProjectInfo` with `[]`.

No `$/progress` message with `kind: end` arrived within 20 seconds. Begin messages were not recorded, so this does not say whether progress had started. No `publishDiagnostics` notification arrived. The hover result was empty. `dbt.getProjectInfo` returned `models_count` 0 and `models_count_is_estimate` true for both launches. Neither server log that was inspected named static analysis, a fallback, or authentication.

Both `initialize` results listed the same capability keys: `codeActionProvider`, `codeLensProvider`, `completionProvider`, `definitionProvider`, `documentFormattingProvider`, `executeCommandProvider`, `hoverProvider`, `inlayHintProvider`, `referencesProvider`, `renameProvider`, `semanticTokensProvider`, `signatureHelpProvider`, `textDocumentSync`, and `workspace`. `diagnosticProvider` was not among them. This client did not declare `textDocument` capabilities, and the project had not finished loading, so the list is not a correction of the binary-derived capability list in section 2.4.

On the same fixture with its dummy profile, a client that answers progress has reached `models_count` 2. That capture is the control for project load. It is not a mode comparison.
