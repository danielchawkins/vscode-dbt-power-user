# dbt Fusion 2.0.6 language server capability spike

Drives `dbt lsp` over stdio with `vscode-jsonrpc` from the repository's `node_modules`. Results feed `docs/research/lsp-capabilities-fusion-2.0.6.md`; raw captures are under `docs/research/evidence/lsp-2.0.6/`.

| Script             | What it does                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.mjs`          | Starts the server, answers `workspace/configuration` and progress creation, records every request with latency, redacts the project root, HOME and credential-like env values |
| `configs.mjs`      | Targets: `jaffle` (prepared fixture) and `finance` (a copy of `finance_general`)                                                                                              |
| `prep-jaffle.sh`   | Copies `test-fixtures/jaffle-shop-duckdb` to `/tmp/lsp-jaffle`, adds a macro, a dotted macro call, a source, an exposure and a singular test, then `dbt build`s it            |
| `probe.mjs`        | Standard LSP methods, every `dbt.*` command and argument shape, freshness, diagnostics and concurrency; five samples per request                                               |
| `bench.mjs`        | LSP against the CLI path the extension runs today, for the p50 and p95 model by lineage size                                                                                  |
| `column-lineage.mjs` | Column lineage request forms per model                                                                                                                                      |
| `lenses.mjs`       | Code lenses by static-analysis mode and language id                                                                                                                           |
| `config-errors.mjs` | Unknown `--target` and an unset `env_var` in `profiles.yml`                                                                                                                  |
| `extras.mjs`       | `compileFile` on unsaved text, `getCurrentNode` on non-model files, adapter introspection through `dbt.show`, a whole-project graph                                          |
| `collect.mjs`      | Copies output into the evidence folder; `--scrub-rows` replaces warehouse row values with their JSON type                                                                     |
| `debug-load.mjs`   | Prints every server message after opening one file                                                                                                                            |

```sh
sh scripts/spikes/lsp-capabilities/prep-jaffle.sh
node scripts/spikes/lsp-capabilities/probe.mjs jaffle /tmp/lsp-out/jaffle
node scripts/spikes/lsp-capabilities/bench.mjs jaffle /tmp/lsp-out/bench-jaffle.json 5
# finance_general: copy without target/ and logs/, then run from the mise environment that holds the credentials.
rsync -a --exclude target --exclude logs <dbt>/finance_general <dbt>/local_packages /tmp/lsp-fin/
cd <finance-pipelines>/fpu-settings && eval "$(mise env -s bash)" && \
  FINANCE_STATIC_ANALYSIS=strict node <repo>/scripts/spikes/lsp-capabilities/probe.mjs finance /tmp/lsp-out/finance-strict
node scripts/spikes/lsp-capabilities/collect.mjs /tmp/lsp-out/finance-strict docs/research/evidence/lsp-2.0.6/finance-strict --scrub-rows
```

`DBT_BIN` overrides the Fusion binary. The project root is canonicalised before launch: Fusion matches document URIs against the realpath of `--project-dir`, so a root under macOS `/tmp` loads no documents otherwise.
