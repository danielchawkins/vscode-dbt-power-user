# Evidence harness

Reproducible runs of `dbt lsp` and the `dbt` CLI against a small synthetic project. Findings live in `docs/research/evidence/README.md`; this directory is how to regenerate them.

```sh
scripts/evidence/run.sh <experiment> [output-root]   # output-root defaults to $TMPDIR/fpu-evidence
```

- `fixture/`: the dbt project, copied fresh for every run.
- `experiments/<name>.sh`: one question per file, sourced by `run.sh`. Use `record <label> <command…>` for CLI steps and `lsp <label> <steps.json> <dbt lsp args…>` for language-server sessions; call `dbtp` instead of `dbt` so `--profiles-dir` is explicit.
- `steps/*.json`: language-server step files for `lsp-session.mjs` (`request`, `notify`, `wait`, `writeFile`; `at` resolves a text position; `$FILE_URI(rel)` and `$ROOT_URI` expand).
- `lsp-session.mjs`: a raw JSON-RPC client that records every message.

`DBT_BIN` must be an absolute path to the `dbt` executable (for example `export DBT_BIN="$(mise where aqua:getdbt.com/dbt-fusion@2.0.6)/dbt"`); `PATH` is not consulted. Nothing here runs in CI or ships in the VSIX.

## `lsp-session.mjs` step types

Older step files keep working; everything below the first row was added for the protocol experiments (`p*-*.sh`).

| Step | Effect |
| --- | --- |
| `{"request", "params", "label", "timeoutMs", "at"}` | Sends a request and awaits it. With `"async": true` it is not awaited; a later `"id": "$LAST_ID"` in params becomes its id (for `$/cancelRequest`). |
| `{"notify", "params"}`, `{"wait": ms}`, `{"writeFile", "text"}` | As before. |
| `{"deleteFile": rel}` | Deletes a project file. |
| `{"include": rel}` | Splices another step file, resolved relative to the including file. |
| `{"waitForProgressEnd": label, "timeoutMs", "fresh"}` | Waits for `$/progress` `kind: end` on a token whose `begin` had that `title`, or that `message` when the title is empty. Fusion 2.0.6 sends `title: ""` with `message: "Analyzing"`. Without `"fresh": true` an end already seen counts. |
| `{"waitForNotification": method, "timeoutMs", "fresh"}` | Same, for any server notification method. |
| `{"snapshot": label}` | Writes `snapshots/<label>.txt` in the step dir: size, sha256 prefix and path of every file under `target/`. |
| `{"clientAnswers": {method: result}}` | Overrides how later server→client requests are answered; `"$NO_ANSWER"` leaves them unanswered. Default: `workspace/configuration` as the extension answers it, everything else `null`. |

Each lsp step dir also gets `lsp-steps.json`: every step with the server messages that arrived from its start until the next step began. `lsp-results.json` entries carry `id`, `elapsedMs` and the same `serverMessages` for the request's own step; logs that arrive during a following `wait` are under that wait in `lsp-steps.json`.

`steps/protocol/gen-*.mjs` generate the larger protocol step files; rerun them after editing.
