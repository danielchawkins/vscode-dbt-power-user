# dbt Fusion linter: architecture and extensibility

Research date: 2026-09-27. Binary under test: `dbt 2.0.6` at `/Users/daniel/.local/share/mise/installs/aqua-getdbt-com-dbt-fusion/2.0.6/dbt` (called `$B` below). All scratch work ran in `/tmp/fpu-lint`. Each claim is labelled **Verified** (with its source) or **Inferred**.

## Verdict

A project cannot add its own lint rule to Fusion without patching the binary. The linter is a fixed set of rules compiled into closed-source Rust. It has no plugin loader, no WASM or Python runtime, no rule-definition DSL, and no Jinja hook. The only extension point is configuration: a SQLFluff-compatible `.sqlfluff` file can enable, disable, and tune the built-in rules, and some of them take parameters that let you express simple custom policy (for example `CV09` blocked words and regexes). If you need anything beyond that, run a separate linter from the extension, or ask dbt Labs to add the rule. Patching the binary is ruled out by the licence and also by practice.

## 1. Architecture

### Where the rules live

- **Verified (binary strings).** The linter is a crate called `sdf-linter`. It is a descendant of SDF, the company dbt Labs acquired: error enums are still documented as "Error codes for the SDF CLI", and the binary contains the `SDF_LINT_PROFILE` and `SDF_FMT_TRACE` environment variables. Each rule is in its own module under `crates/sdf-linter/src/linters/`. Command: `strings $B | grep -oE 'crates/[a-z_-]+/src/[A-Za-z0-9_/]+\.rs' | grep -E 'sdf-linter|dbt-lsp/src/linter|sqlfluffrs' | sort -u`. Excerpt:

```text
crates/dbt-lsp/src/linter/format.rs
crates/dbt-lsp/src/linter/lint_fix.rs
crates/dbt-lsp/src/linter/lint_fix_and_format.rs
crates/sdf-linter/src/linter.rs
crates/sdf-linter/src/rendered_linter.rs
crates/sdf-linter/src/skeleton.rs
crates/sdf-linter/src/noqa.rs
crates/sdf-linter/src/sqlfluff_config.rs
crates/sdf-linter/src/sqlfluff_templated_file.rs
crates/sdf-linter/src/format_reflow_engine.rs
crates/sdf-linter/src/linters/alias_length.rs
crates/sdf-linter/src/linters/import_ctes.rs
crates/sdf-linter/src/linters/join_condition_or.rs
... (59 rule modules in linters/)
crates/sqlfluffrs_reflow/src/{apply,depthmap,elements,patch,rebreak,reindent,respace,sequence}.rs
```

- **Verified (binary strings).** The binary vendors SQLFluff's Rust lexer and parser, pinned to a git checkout: `/Users/runner/.cargo/git/checkouts/sqlfluff-ec07f909c0653966/e6f2fad/sqlfluffrs/{sqlfluffrs_lexer,sqlfluffrs_parser,sqlfluffrs_types,sqlfluffrs_dialects}`. It also contains a private `sqlfluffrs_reflow` crate for layout and formatting. The rest of the SQL front end is dbt's own ANTLR stack: `dbt-antlr4-2.0.2`, `dbt-sql`, and `dbt-frontend-common`.
- **Verified (source).** Upstream `sqlfluffrs_rules` is Rust-native rule detection with optional PyO3 bindings that are "registered by the root crate". <https://raw.githubusercontent.com/sqlfluff/sqlfluff/main/sqlfluffrs/sqlfluffrs_rules/Cargo.toml>.
- **Inferred.** Fusion does not use SQLFluff's Python plugin registry. Evidence: `strings $B | grep -c 'libpython\|PyInit_'` returns `0`.

### What is public and what is closed

- **Verified (source).** The public crates list contains no `sdf-linter`, no `dbt-lsp`, and no `sqlfluffrs_reflow`. That holds for <https://github.com/dbt-labs/dbt/tree/main/crates>, where development now happens, and for the older mirror <https://github.com/dbt-labs/dbt-fusion/tree/main/crates>. The public tree does contain the crates the linter depends on:
  - `dbt-frontend-common`, `dbt-sql`, and `dbt-sql-keywords`. On dbt-fusion their last commit is titled "linter like a sqlfluff (#10198)".
  - `dbt-error`, which has `LintCheckFailed = 1039`: <https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/crates/dbt-error/src/codes.rs>.
  - `dbt-common`, whose `io_args.rs` has `force_enable_linter: bool` ("Always enable the linter").
- **Verified (source).** Public code refers to the closed crate by path. `crates/dbt-jinja/minijinja/src/vm/mod.rs` in dbt-labs/dbt says "Keep in sync with `sdf_linter::skeleton::HOLE_MARKER` (crates/sdf-linter/src/skeleton.rs)". `crates/dbt-jinja-utils/src/listener.rs` refers to `sdf_linter::rendered_linter::render_symbolic_lint_targets`. A GitHub code search for `path:crates/sdf-linter` in dbt-labs/dbt returns no results.
- **Verified (source).** Licensing:
  - <https://github.com/dbt-labs/dbt-fusion/blob/main/LICENSES.md> puts everything except `dbt-agate`, `dbt-auth`, `dbt-adapter`, `dbt-jinja`, and `dbt-xdbc` under the Elastic License 2.0. `dbt-frontend-common` is therefore ELv2, not Apache.
  - The shipped binary is covered by the dbt Product Licensing Agreement (<https://www.getdbt.com/dbt-fusion-engine-license-agreement>). §3.2(1) forbids users to "reverse-engineer, decompile, disassemble, or attempt to discern or derive the source code".

### How rules are registered

- **Inferred.** Rules are registered statically at compile time. Each module in `linters/` implements an internal trait and is listed in `linter.rs`; there is no runtime registry. Evidence:
  - No dynamic-loading strings: `grep -c 'wasmtime\|wasmer'` returns `0` and `grep -c 'libloading'` returns `0`.
  - Every `plugin` string in the binary belongs to unrelated features, such as adapter Jinja (`config.get('plugin')`) and the `crates/dbt-manifest-plugin/*` crates for cross-project refs and artifact download.
  - An unknown rule code is silently ignored (next section).
- **Verified (binary strings and public source).** Every rule has a Fusion diagnostic code in the frontend range. The public `dbt-frontend-common/src/error/codes.rs` defines codes 101–175, for example `KeywordCaseMismatch = 107`, `PreferCTE = 113`, `UnusedJoin = 171`, `JinjaPadding = 175`, and `LinterError = 127`. See <https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/crates/dbt-frontend-common/src/error/codes.rs>. The 2.0.6 binary emits `JoinConditionDisallowedOr (dbt0178)`, a code that is not in the public mirror. New rules therefore need a new enum variant compiled into the binary.

### Rendering pipeline

- **Verified (docs).** `dbt lint` renders the Jinja before linting and has three render modes:
  - `symbolic` (default): introspective adapter calls become holes.
  - `rendered`: the Jinja is rendered against parse-time stubs.
  - `turbo`: the template is read syntactically and every `{{ }}` becomes a hole.

  When an `{% if %}` cannot be resolved, it lints up to `render_variant_limit` render variants (default 5). Fixes are mapped back to the source through `macro_spans`. <https://docs.getdbt.com/reference/commands/lint>.
- **Verified (binary strings).** The binary contains `jinja_render_mode` and `render_variant_limit`. It also warns `dbt lint/format only supports SQLFluff templater 'dbt'`.

## 2. Configuration per project

- **Verified (docs).** The linter is configured only through SQLFluff files: the nearest `.sqlfluff` found by walking up the tree, `.sqlfluffignore`, and inline `-- noqa`, `-- noqa: CP01, RF03`, `-- noqa-file`, and `-- sqlfluff:disable CP01`. Nothing is configured in `dbt_project.yml`. CLI flags override the file. <https://docs.getdbt.com/reference/commands/lint>.
- **Verified (CLI).** `$B lint --help` lists `--fix`, `--config <FILE>`, `--rules <RULES>`, `--exclude-rules <RULES>`, `--changed`, `--format <FORMAT>`, and `--jinja-render-mode <MODE>`. Excerpt:

```text
--config <FILE>
    Path to a `.sqlfluff` config file. Auto-discovers one by walking up the project directory tree when not specified
--rules <RULES>
    Comma-separated SQLFluff rule codes or dotted names to enable (e.g. `CP01,LT04` or `capitalisation.keywords`). Overrides the `rules` key in the config file
--exclude-rules <RULES>
    Comma-separated SQLFluff rule codes or dotted names to disable. Added on top of any `exclude_rules` already set in the config file
--format <FORMAT>
    Output format for lint violations: human (default), json, github-annotation
```

- **Verified (binary strings).** The binary contains these config keys and section names: `[sqlfluff]`, `sqlfluff:rules:`, `rules =`, `exclude_rules =`, `.sqlfluffignore`, `noqa-file`, `sqlfluff:disable`, `alias_case_check`, `min_alias_length`, `max_alias_length`, `group_by_ordinal`, `layout.operators`, `layout.functions`, `implicit_indents`, `blocked_words`, `blocked_regex`, `match_source`, and `'Invalid .sqlfluff [dbt] configuration:`.
- **Verified (experiment).** An unknown rule code is silently ignored. Setup: a `.sqlfluff` in `/tmp/fpu-lint/proj` with `rules = CP01,DBT02,MY01` and the model `SELECT a.x, b.y FROM raw.t a JOIN raw.u b ON a.id = b.id OR a.k = b.k`. Command: `$B lint --profiles-dir . --no-manage-state`. The run reported `DBT02` and gave no warning or error for `MY01`:

```text
[warning] [JoinConditionDisallowedOr (dbt0178)]: JOIN condition should not use OR; split into separate joins or a UNION instead. [DBT02].
  --> models/m.sql:1:46
Finished 'lint' with 1 warning for target 'dev' [534ms]
```

- **Verified (docs).** Because the Studio IDE still runs Python SQLFluff while CI jobs on v2 run `dbt lint`, the two can report different violations for the same code. Layout rules such as `LT02` are a known difference. <https://docs.getdbt.com/reference/commands/lint>.

## 3. Rule inventory

- **Verified (binary strings).** Command: `strings $B | grep -oE '\b(AL|AM|CP|CV|JJ|LT|RF|ST)[0-9]{2}\b' | sort -u`. Output:

```text
AL01–AL10  AM01–AM07  CP01–CP05  CV01–CV12  JJ01  LT01 LT03 LT04  RF01–RF06  ST01–ST12
```

A second grep, `grep -oE '\bDBT0[0-9]\b|dbt\.(import_ctes|...)'`, found `DBT01`–`DBT05` together with the names `dbt.import_ctes`, `dbt.join_condition_or`, `dbt.function_wrapped_filter_column`, `dbt.leading_wildcard_like`, and `dbt.hard_coded_reference`.

- **Inferred.** Other `LT` rules, such as `LT02` and `LT05`, are probably implemented by the reflow engine and not stored as literal strings, so this grep undercounts layout rules. The docs call `LT*` the rules used by `dbt format`.
- **Verified (docs).** The DBT rules are off by default and are turned on through `rules`:

| Code  | Name                                 | Meaning                                                             |
| ----- | ------------------------------------ | ------------------------------------------------------------------- |
| DBT01 | `dbt.import_ctes`                    | Each `ref()` or `source()` must be imported through a top-level CTE |
| DBT02 | `dbt.join_condition_or`              | A JOIN's ON clause must not contain OR                              |
| DBT03 | `dbt.function_wrapped_filter_column` | A comparison must not wrap a bare column in a function              |
| DBT04 | `dbt.leading_wildcard_like`          | A LIKE pattern must not start with a wildcard                       |
| DBT05 | `dbt.hard_coded_reference`           | A relation must not be hard-coded as a literal string               |

- **Verified (docs).** These rules report violations but have no `--fix`: `AL03/04/06/08`, `RF01/02/04/05`, `ST03/04/05/06/07/09/10/11`, `AM01/06`, and `CV08/09/12`. `--fix` makes a single pass. Supported dialects are Snowflake, BigQuery, DuckDB, Redshift, Databricks, and SparkSQL.

## 4. How lint results reach the LSP

- **Verified (CLI).** Linting in the language server is off unless enabled. `$B lsp --help` prints `--lint-enabled <LINT_ENABLED>  Enable the SQL linter (defaults to disabled when unset) [possible values: true, false]`. The binary also contains `lint_enabled`.
- **Verified (binary strings).** The LSP registers the code action kind `source.fixAll.dbtLintFix`. The `strings` output has `source.fixAll` next to it, and the user-facing text includes "fix lint issues in this document", "fixable lint issues and format document", and "This file would be reformatted by `dbt fmt`". The source files are `crates/dbt-lsp/src/linter/{lint_fix,lint_fix_and_format,format}.rs`.
- **Verified (CLI) / Inferred (LSP).** A CLI violation carries two identifiers: a Fusion diagnostic code (`dbt0178`, name `JoinConditionDisallowedOr`) and the SQLFluff rule code in the message suffix (`[DBT02]`). JSON output uses the SQLFluff shape: `{"filepath","violations":[{"start_line_no","start_line_pos","code":"DBT02","description","name":"dbt.join_condition_or","warning":false}]}`. It is inferred that LSP diagnostics use the same `dbtNNNN` code with the message suffix, since both paths call `sdf-linter`. This was not captured on the wire.
- **Verified (docs).** Editor linting has no separate configuration. The VS Code extension feature table lists "Linter warning diagnostics" for all users. <https://docs.getdbt.com/docs/dbt-extension-features>.
- **Inferred.** The LSP reads the same `.sqlfluff` as the CLI because it shares `sdf-linter::sqlfluff_config`. It is untested whether a changed `.sqlfluff` takes effect without restarting the server.

## 5. Extension points

| Mechanism                                                          | Present?         | Evidence                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enabling, disabling, and tuning built-in rules through `.sqlfluff` | Yes              | Docs and CLI help, **Verified**                                                                                                                                                                                                                  |
| Parameterized built-in rules that can express simple custom policy | Yes, limited     | `CV09` experiment below, **Verified**                                                                                                                                                                                                            |
| Per-line and per-file suppression                                  | Yes              | Docs, **Verified**                                                                                                                                                                                                                               |
| SQLFluff Python plugins (pluggy entry points)                      | No               | `libpython`/`PyInit_` count 0; SQLFluff plugin discovery needs an installed Python package: <https://docs.sqlfluff.com/en/stable/guides/setup/developing_custom_rules.html>. **Verified** absence of the runtime; **Inferred** no plugin support |
| WASM, dylib, or other dynamic rule loading                         | No               | `wasmtime`/`wasmer`/`libloading` count 0, **Verified**                                                                                                                                                                                           |
| Jinja macros as lint rules                                         | No               | No such feature in the docs; Jinja is only a rendering input. **Inferred**                                                                                                                                                                       |
| Rule configuration in `dbt_project.yml`                            | No               | The docs cite only `.sqlfluff`. **Verified (docs)**                                                                                                                                                                                              |
| Unknown or custom rule codes                                       | Silently ignored | Experiment, **Verified**                                                                                                                                                                                                                         |

- **Verified (experiment).** `CV09` provides config-only custom policy. Setup: `.sqlfluff` with `rules = CV09` and `[sqlfluff:rules:convention.blocked_words]` set to `blocked_words = legacy_amount`, `blocked_regex = ^delet`, `match_source = true`. Model: `select id, legacy_amount from {{ ref('x') }} where status = 'deleted'`. `$B lint --profiles-dir . --no-manage-state --format json` returned:

```json
[{"filepath":"models/m.sql","violations":[{"start_line_no":1,"start_line_pos":12,"code":"CV09","description":"Blocked word 'legacy_amount' is used as an identifier [CV09]","name":"convention.blocked_words","warning":false}, ...]}]
```

Findings from this run:

- The blocked word was caught.
- The regex did not match the string literal `'deleted'`, because `CV09` checks identifiers and keywords.
- Each violation was reported twice, with one copy ending in `.`. This looks like a 2.0.6 bug.
- The first attempt aborted with `zsh: abort` because the output was piped into `head`. That is a SIGPIPE-type crash under a closed pipe, not a lint result. Rerunning without the pipe worked.

## 6. Can we add rules? Options ranked

1. **Configuration only. Recommended first.** Tune the built-in rules in the project's `.sqlfluff`. `CV09` covers banned identifiers and keywords. `AL05`–`AL07`, `CP*`, `RF*`, `ST*`, and `DBT01`–`DBT05` cover most common house-style rules. The work belongs in the Consumer Repository; the extension needs no code. It can pass `--lint-enabled true` to `dbt lsp` behind a setting and offer `source.fixAll.dbtLintFix` on save. Limits: only the logic that ships in the binary, and nothing that reasons about schema or dbt graph semantics beyond `DBT01`–`DBT05`. Confidence: High.
2. **Ask dbt Labs to add the rule.** File a feature request on <https://github.com/dbt-labs/dbt/issues> with the `Linter` label, which is the channel the lint docs name. You cannot open a pull request against the rule code because `sdf-linter` is not public. If a rule belongs in SQLFluff generally, a SQLFluff contribution may be ported later, since the docs say "dbt Labs intends to track the latest SQLFluff rule spec going forward". Slow and outside our control. Confidence: High that no pull-request path exists; Medium on responsiveness.
3. **Run a separate linter from the extension.** Choose one of these designs:
   - (a) Python SQLFluff with custom pluggy rules over compiled SQL from `target/compiled/**` or the LSP's compiled-code view. Use the `placeholder` or `raw` templater, because the `dbt` templater needs dbt Core, which this product boundary excludes.
   - (b) sqlglot, or another parser in TypeScript or WASM, for AST-level project rules.
   - (c) Rules written in TypeScript inside the extension against Fusion outputs such as the manifest or LSP data.

   Costs:
   - Diagnostics on compiled SQL must be mapped back to source ranges. Fusion's `macro_spans` source map is internal, so this mapping is approximate.
   - A second dialect parser can disagree with Fusion.
   - A Python or other toolchain becomes an external dependency. It must be optional, resolved from `PATH` or a setting, and never installed by the extension, consistent with the tool-manager-neutral rule in `AGENTS.md`.
   - Diagnostics from two sources appear side by side.

   This is the only option that allows arbitrary custom logic without the vendor. Confidence: High that it is feasible; Medium on range-mapping quality.
4. **Patch the binary. Inadvisable.**
   - Licence: adding a rule means reverse-engineering the closed `sdf-linter` and `dbt-lsp` code. The dbt Product Licensing Agreement §3.2(1) forbids reverse-engineering, decompiling, and disassembly, and a breach allows termination (<https://www.getdbt.com/dbt-fusion-engine-license-agreement>). The public crates the linter uses, such as `dbt-frontend-common`, are ELv2, and the linter itself is not published at all, so you could not build a patched linter from source.
   - Engineering: rules are statically linked Rust and need new error-code enum variants. Every Fusion release would need the patch reapplied.
   - Distribution: shipping a modified binary would conflict with this fork's decision to resolve an unmodified `dbt` from `PATH`.

   Confidence: High.

## Sources

- dbt lint command reference: <https://docs.getdbt.com/reference/commands/lint> (accessed 2026-09-27; primary)
- dbt VS Code extension features: <https://docs.getdbt.com/docs/dbt-extension-features> (primary)
- dbt v2 supported features and limitations: <https://docs.getdbt.com/docs/fusion/supported-features> (primary)
- dbt Product Licensing Agreement: <https://www.getdbt.com/dbt-fusion-engine-license-agreement> (primary)
- dbt-fusion LICENSES.md: <https://github.com/dbt-labs/dbt-fusion/blob/main/LICENSES.md> (primary)
- dbt-fusion crates listing: <https://github.com/dbt-labs/dbt-fusion/tree/main/crates> (primary)
- dbt-labs/dbt crates listing: <https://github.com/dbt-labs/dbt/tree/main/crates> (primary)
- CLI error codes: <https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/crates/dbt-error/src/codes.rs> (primary)
- Frontend and lint codes: <https://raw.githubusercontent.com/dbt-labs/dbt-fusion/main/crates/dbt-frontend-common/src/error/codes.rs> (primary)
- `sdf_linter` references in `dbt-jinja` and `dbt-jinja-utils` in dbt-labs/dbt, found by GitHub code search for `sdf_linter` (primary)
- SQLFluff custom rules and plugin discovery: <https://docs.sqlfluff.com/en/stable/guides/setup/developing_custom_rules.html> (primary)
- `sqlfluffrs_rules` Cargo.toml: <https://raw.githubusercontent.com/sqlfluff/sqlfluff/main/sqlfluffrs/sqlfluffrs_rules/Cargo.toml> (primary)
- Local binary `dbt 2.0.6`: `lint --help`, `lsp --help`, `strings` (193,757 lines, saved to `/tmp/fpu-lint/strings.txt`), and scratch-project runs in `/tmp/fpu-lint/proj` (primary)
