# dbt Fusion 2.0.8 request-timing spike

Intent: refactor-scout evidence for the request-timing plan (fixed `COMMAND_DEADLINE_MS` replaced by request policies). Reuses `../lsp-capabilities/lib.mjs`. Output summarised in `docs/research/evidence/lsp-2.0.8-timing/`.

| Script                 | What it measures                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `timing.mjs`           | listNodes before the first compile, two at once, `$/cancelRequest`, during a recompile, mixed with other commands, a client `workDoneToken`; every `dbt/*` notification and `$/progress` with times |
| `cost.mjs`             | table vs column listNodes, two column selectors in one call, cancel then resend, getProjectInfo during listNodes, server silence during a request |
| `after-background.mjs` | column listNodes after the background full compile finished                                                  |

```sh
sh scripts/spikes/lsp-capabilities/prep-jaffle.sh   # HOME=/tmp/fpu-home if ~/.dbt is not writable
DBT_BIN=<fusion 2.0.8> node scripts/spikes/lsp-timing/timing.mjs jaffle /tmp/lsp-timing-jaffle.json
# finance: copy finance_general and its ../local_packages to /tmp/lsp-fin; a dummy Snowflake profile suffices in baseline.
DBT_ENGINE_PROFILES_DIR=<dummy profiles> PROBE_MODEL=models/31_marts/dimensions/dim__commitment_types.sql \
  PROBE_UID=model.finance_general.dim__commitment_types PROBE_COLUMN=COMMITMENT_TYPE PROBE_COLUMN2=COMMITMENT_TYPE_HK \
  DBT_BIN=<fusion 2.0.8> node scripts/spikes/lsp-timing/cost.mjs finance /tmp/lsp-cost-finance.json
```

Findings (finance_general, 995 models, baseline, Fusion 2.0.8):

- A column-lineage `dbt.listNodes` takes 10.0–13.4 s (n=15), with or without a completed background compile. A table-grain one takes 132–134 ms. The incremental compile each request triggers takes 104–2,280 ms, so most of the time is the lineage query.
- The server sends nothing for up to 11.1 s while that query runs. The request's own progress token (`…:dbt/progress/listNodes`, "Computing Lineage") has `begin` and `end` and no `report`.
- The server ignores `$/cancelRequest`. A request cancelled after 300 ms ran its full 11.9 s and returned a normal result.
- A second `listNodes` makes the server answer the first with the result body `{"error":"Operation cancelled"}` (not an LSP error) within 0.1–0.5 s. The second then takes 20.4–21.0 s (n=2), about two requests' worth.
- `getCurrentNode`, `compileFile` and `getProjectInfo` answer in 0–1 ms while a `listNodes` runs.
- The server ignores a client `workDoneToken`. It makes its own tokens through `window/workDoneProgress/create`.
- Notifications seen: `dbt/lspCompileStart`, `dbt/lspCompileComplete`, `dbt/lspBackgroundCompileStart` and `dbt/lspBackgroundCompileComplete` (`compile_type`, `duration_ms`, `models_count`, `errors`). Every `listNodes` triggers its own incremental start/complete pair. The background full compile starts about 1.2 s after the last request (11.3–12.3 s on finance). A failed compile sends both complete notifications.
- Two column selectors in one call return only the last selector's lineage (jaffle strict). One request per target column is the only form that works.
