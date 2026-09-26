# Fusion Power User

A local-first VS Code / Cursor extension for dbt Fusion projects, forked from `vscode-dbt-power-user`. The native dbt Fusion language server owns editor intelligence; no feature depends on a hosted service, an extension-specific account, telemetry, or a Python bridge.

This is a private fork with no intent to merge upstream. Upstream contributor process, marketplace publication, and compatibility with Altimate's product are not constraints. Delete freely.

Read before planning or changing code:

- [`CONTEXT.md`](CONTEXT.md) — canonical product language. The vocabulary is fixed; extend it rather than inventing synonyms.
- [`docs/adr/`](docs/adr/) — the product boundary, the LSP decision, and project scoping.
- [`docs/refactor/fusion-lsp-plan.md`](docs/refactor/fusion-lsp-plan.md) — phased implementation plan. Work the steps in order; each PR bookmark contains focused revisions and ends with green tests.
- [`docs/refactor/implementation-dispatch.md`](docs/refactor/implementation-dispatch.md) — land each step as a feature PR against `main`.

The parent session orchestrates implementation. Use a fast coding agent for implementation and accepted fixes, a different higher-reasoning read-only agent for detailed review, then perform a quick evidence check before resuming the same coding agent. Both roles inspect revisions through `just jj`; implementers create focused revisions but never push, and reviewers never mutate the workspace.

## Two contexts — state which one you are in

This repository is both a product and a development environment, and they have opposite rules. Before changing anything, say which context the change belongs to. Confusing them is the most expensive mistake available here.

**The shipped extension is tool-manager-neutral.** It runs in someone else's repository, which may use mise, asdf, Homebrew, a bare `PATH`, or nothing. It resolves `dbt` from `PATH` or an explicit path setting. It must never invoke `mise` or `just`, never read `mise.toml`, and never assume a Consumer Repository's layout. This covers `src/`, `webview_panels/`, and the `package.json` contributions.

**This repository's own tooling has chosen mise and Just.** `mise.toml` pins the Node runtime, the contributor CLIs, and a dbt Fusion binary for integration tests; contributors and CI go through `just`. None of it ships in the VSIX.

Pinning Fusion in `mise.toml` is therefore correct — it gives *this* repo's tests a real binary. The tests must locate that binary through configuration or `PATH`, never by shelling out to mise, so the same suite passes on a machine without it.

## Product boundary

The extension supports dbt Fusion 2.0.5 and later. It does not support dbt Core or dbt Cloud, call hosted APIs, require an account, collect telemetry, install or update dbt, or recursively discover every `dbt_project.yml` in a workspace.

## Commands

```bash
scripts/workspace/setup/setup-environment.sh # first run: bootstrap host, then setup
just setup                                  # later: refresh tools, dependencies, hooks, jj
just sync                                   # refresh npm dependencies only
just update                                 # update dependencies within declared ranges
just fmt                                    # write lint and format fixes
just lint                                   # read-only code, shell, lockfile, and Markdown checks
just check                                  # lint plus compile and unit tests
just jj ...                                 # run jj, gating git push on just check
just package                                # build the VSIX
just smoke                                  # packaged-VSIX smoke against both pinned hosts
just release                                # local dry run of the tag-triggered release
just --list
```

The environment script installs mise and the mise-managed Just needed to enter the task layer, then calls `just setup`. Installers skip existing tools; pass `--force` to either entry point to reinstall managed tools and reapply jj configuration. `fmt` writes fixes; `lint` verifies code, shell, formatting, lockfiles, and Markdown without writing; `check` adds compile and unit tests. `just check` is the only full gate: CI, the pre-push hook, and humans call it; pre-commit runs relevant subsets from that gate.

Just is the workflow authority. The root file owns repository workflows and delegates webview-specific work to `webview_panels/justfile`; package scripts expose package-local operations and required npm or VS Code lifecycle hooks, while Just owns repository-wide grouping and composition. Each tool resolves scope from its own config (`.eslintrc.json`, `dprint.json`, `rumdl.toml`). ESLint and Prettier own TypeScript, JavaScript, JSON, and CSS; dprint and rumdl own Markdown; shfmt and ShellCheck own shell scripts. No file type has two formatters. Copied skills under `.agents/skills/` must pass the Markdown checks. Author Just recipes with the `justfile-expert` skill.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the *why* behind activation, Declared Projects, the Fusion client pool, and the metadata port.

Two build outputs from one repository: the extension host bundle (TypeScript, rsbuild) and the webview panels (React 18 + Vite + Redux Toolkit, built separately under `webview_panels/`). They communicate through VS Code's webview messaging with typed message contracts.

`src/extension.ts` → `src/dbtPowerUserExtension.ts` is the single activation path. Every collaborator is constructed through an Inversify container configured in `src/inversify.config.ts`. Fusion is the only constructible `DBTProjectIntegration`; dbt Core and dbt Cloud construction is removed.

Load-bearing directories (abridged):

```text
src/
├── projects/                # Project Registry and Project Context (Declared Project scoping)
├── fusion/                  # executable resolution, version gate, static-analysis mode
├── lsp/                     # Fusion client pool, reverse-socket transport, status
├── metadata/                # ProjectMetadataSource port and its manifest implementation
├── dbt_client/              # dbt integrations, manifest parsing, command execution
├── services/                # business logic, incl. queryManifestService
├── autocompletion_provider/ # language features, one provider per concern
├── definition_provider/
├── hover_provider/
├── commands/                # VS Code command implementations
├── treeview_provider/
├── webview_provider/        # panel hosts
└── test/                    # Jest suites, hand-written VS Code mocks
```

Tests are Jest with `ts-jest` against a hand-written VS Code mock (`src/test/mock/vscode.ts`). Debug the extension with the "Launch Extension" configuration.

Two facts dominate change ordering, both detailed in the plan:

- The codebase is **manifest-driven**. `dbt parse` produces `manifest.json`, parsers build the metadata maps, and every panel, tree, lens, and language provider consumes them through `QueryManifestService` via `ManifestCacheProjectAddedEvent`. `ProjectMetadataSource` (`src/metadata/`) is the producer port; the Fusion LSP payload cannot populate the full contract (see `docs/lsp-metadata-gaps.md`), so the manifest source remains the only implementation. Do not introduce a second consumer seam.
- **The dbt integration layer is owned code in `src/dbt_integration/`.** It holds the manifest parsers, the Fusion CLI command integration, and the shared domain types, vendored from the MIT-licensed `@altimateai/dbt-integration` with Core, Cloud, Python, and hosted paths removed. Parsers depend on `ManifestProject`, which `FusionProjectIntegration` implements. Column-level lineage is not implemented. Never patch `node_modules`.

## Comments and prose

- **No issue or PR numbers in code.** Never write `#127`, `PR #12`, or "step 1a" in a comment. A number names a moment in history, not a property of the code. State the behavior. Git blame and the PR already bind history.
- **Compression is the goal.** Optimize for the effort to reconstruct intent and behavior, not word count. A qualifier that does not change what the reader *does* is noise. If a clause survives deletion with no actionable loss, delete it.
- Keep code and comments shorter than 120 characters. In Markdown, write each prose paragraph on one physical line and rely on editor soft wrapping; do not hard-wrap prose.
- **Three homes.** Inline comments carry a rare local gotcha — a line that looks wrong but is correct — ideally one line. TSDoc carries the contract. `docs/` carries the rationale; the *why* never lives in code.
- **Avoid mannered prose.** Do not use metaphor or a striking phrase where a plain statement would do. A metaphor carries associations the writer did not intend. When a literal phrase is available, use it.

## Gates

`just check` and `just package` must pass on every PR bookmark tip. `just smoke` runs the packaged-VSIX smoke assertions locally; CI runs the same assertions through `smoke-vscode` and `smoke-cursor`.

## Jujutsu

`just setup` installs jj through mise and colocates this clone through `scripts/workspace/setup/configure-jujutsu.sh`. It needs `--force` to reapply existing jj configuration.

Run every jj command as `just jj ...`, never as bare `jj`. The recipe forwards its arguments unchanged and prepends `just check` to `git push`, which jj would otherwise send without running Lefthook's pre-push hook. Push to `origin`; do not push to `upstream` unless asked. Use the `jujutsu` skill for the commands themselves.
