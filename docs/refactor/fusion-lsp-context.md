# Fusion LSP refactor context

This document gives an implementation agent the context needed to refactor [`danielchawkins/vscode-dbt-power-user`](https://github.com/danielchawkins/vscode-dbt-power-user) without access to the design conversation that produced the plan. Work starts on the `fusion-lsp-client` branch.

Read these first:

- [`CONTEXT.md`](../../CONTEXT.md) for canonical product language.
- [`0001-local-fusion-only-product.md`](../adr/0001-local-fusion-only-product.md) for the product boundary.
- [`0002-use-the-native-fusion-lsp.md`](../adr/0002-use-the-native-fusion-lsp.md) for the semantic architecture.
- [`0003-scope-services-to-declared-projects.md`](../adr/0003-scope-services-to-declared-projects.md) for project ownership.
- [`tooling-adoption.md`](tooling-adoption.md) for the contributor environment decision that precedes product work.
- [`fusion-lsp-feature-disposition.md`](fusion-lsp-feature-disposition.md) for the current feature inventory.
- [`fusion-lsp-plan.md`](fusion-lsp-plan.md) for implementation and release sequencing.

## Repositories

The implementation repository is the personal Power User fork:

- Upstream: `AltimateAI/vscode-dbt-power-user`
- Fork: `danielchawkins/vscode-dbt-power-user`
- Design branch: `fusion-lsp-client`
- Product identity: `danielchawkins.fusion-power-user`
- Display name: `Fusion Power User`

[`Kikoff/finance-pipelines`](https://github.com/Kikoff/finance-pipelines) is both a tooling reference and the first Consumer Repository. The extension must not depend on that repository's layout, but its setup should be easy to pin and install there.

## Product boundary

Fusion Power User is an independent, MIT-licensed product fork for local dbt Fusion development. It supports dbt Fusion 2.0.5 and later. It warns once, then continues, when it encounters an untested future major version.

The extension does not:

- support dbt Core, dbt Cloud, or Python-based dbt integrations;
- call Altimate-hosted APIs;
- require an extension-specific account, API key, or authentication flow;
- collect telemetry;
- provide AI, collaboration, MCP, conversation, or notebook features;
- install or update dbt Fusion;
- bypass licensing checks enforced by the dbt Fusion binary; or
- recursively discover every `dbt_project.yml` under a workspace.

The comprehensive target retains local query analysis, model operations, lineage, project trees, and documentation editing. Prereleases deliver that target incrementally; an early alpha is not the final product boundary.

## Verified current architecture

Power User does not currently use dbt Fusion's LSP.

The extension depends on `@altimateai/dbt-integration`. Its Fusion strategy:

1. locates `dbt`;
2. runs `dbt --version` and `dbt debug`;
3. runs `dbt parse --log-format json`;
4. reads and parses `manifest.json`;
5. emits a manifest-cache event; and
6. runs separate CLI commands for compile, show, catalog, run, build, and test workflows.

The extension then implements editor intelligence directly with VS Code provider APIs:

- `src/autocompletion_provider/` registers completion providers;
- `src/definition_provider/` registers definition providers;
- `src/hover_provider/` registers hover providers;
- `src/validation_provider/` owns diagnostics; and
- `src/dbt_client/` distributes manifest-derived metadata to those providers.

For example, `ModelAutocompletionProvider` builds completion entries from `nodeMetaMap` after a manifest-cache event. There is no `vscode-languageclient` dependency, `LanguageClient`, `dbt lsp` process, or LSP transport in the current extension.

The existing Fusion integration is therefore a CLI-and-artifact adapter beneath a custom language implementation. The refactor replaces that language implementation; it does not merely change the executable path.

### Migration-critical coupling

The current `DBTFusionCommandProjectIntegration` extends the Cloud integration. Although it overrides command execution to call the local CLI, inherited run, build, test, compile, and defer paths can still pass through Cloud helpers that call `throwIfNotAuthenticated()`. Extract a Fusion-only operation layer before deleting hosted validation or authentication code.

Fusion is also coupled to Python in two places:

- `DBTClient` verifies and reports Python before it accepts the Fusion installation; and
- the shared CLI execution strategy reads environment variables through the Python environment abstraction.

Introduce Fusion-native executable and environment services before removing the Python bridge or the Python extension dependency. Characterization tests must demonstrate local run/build/test and environment inheritance without Python or Altimate state.

The current parse and metadata flow is separate:

```text
dbt parse
  -> target/manifest.json
  -> target watcher
  -> manifest parser
  -> metadata maps
  -> language providers and local panels
```

Keep this flow only for a retained consumer that lacks an LSP equivalent. Move language providers first; move local panels incrementally; delete the watcher and parser only when no justified artifact consumer remains.

## Verified dbt Fusion LSP behavior

dbt Fusion 2.0.5 ships its CLI and language server in one executable:

```text
dbt 2.0.5
dbt-lsp 2.0.5
```

The server uses reverse TCP rather than standard input/output:

1. the client listens on an ephemeral loopback port;
2. the client launches `dbt lsp --socket <port> --project-dir <root>`;
3. dbt connects back to the listener; and
4. both sides exchange normal LSP `Content-Length` framed JSON-RPC messages.

The client must bind to `127.0.0.1`, start listening before launching dbt, accept one connection, terminate the child on shutdown, and release every socket and watcher on failure.

A direct capability probe against 2.0.5 returned:

- completion, hover, definition, references, rename, and signature help;
- diagnostics through normal LSP publication;
- semantic tokens and inlay hints;
- document formatting;
- code actions, including `source.fixAll.dbtLintFix`;
- code lenses; and
- custom commands including `dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`, and `dbt.show`.

Start the server with linting enabled. Let VS Code or the Consumer Repository decide whether formatting and fixes run on save.

## Target architecture

### Project registry

The project registry evaluates configuration once per workspace folder.

- With no explicit configuration, a folder whose root contains `dbt_project.yml` becomes one Declared Project.
- Explicit `fusionPowerUser.projects` entries are relative to the workspace folder that supplies the setting.
- Paths outside that workspace folder are invalid.
- Discovery is not recursive.
- An installed or local package remains a Dependency Project unless separately declared.

The registry owns project addition, removal, configuration changes, and duplicate-root rejection.

### Project context resolver

Every file and command resolves to one Project Context before work begins. The resolver uses the most specific Declared Project containing the resource. A file outside every Declared Project receives no dbt service. Multi-root windows must never fall back to whichever project registered first.

dbt remains responsible for package installation, `.dbtignore`, package parsing, and cross-project references inside each Declared Project. The extension must not rebuild those rules.

### Fusion executable resolver

The extension is tool-manager-neutral:

- default executable: `dbt` on the extension host's `PATH`;
- optional machine-appropriate executable-path setting;
- no downloader and no direct mise invocation;
- run `dbt --version` before opening a session;
- reject versions older than 2.0.5; and
- warn once, without blocking, for an untested future major.

Expose one writable executable-path setting so [`mise-vscode`](https://github.com/hverlin/mise-vscode) can configure it through a custom binary extension. Pursue a built-in mise-vscode mapping after the setting contract stabilizes.

### Environment

Launch each process with:

1. the extension host's inherited environment, including values loaded by mise-vscode;
2. dbt's normal project-root `.env` behavior; and
3. optional non-secret per-project overrides such as profiles directory, profile, target, and a folder-scoped environment-file path.

Do not reuse `python.envFile`; it configures the Python extension, not VS Code generally. Do not prompt for or store warehouse credentials.

### LSP project session

One session owns one Declared Project:

- listener, child process, accepted socket, and `LanguageClient`;
- document selectors scoped to that project with `RelativePattern`;
- project-specific initialization options and configuration;
- restart limits and actionable blocking failures;
- standard LSP features supplied directly by `vscode-languageclient`; and
- typed wrappers for retained dbt custom commands.

The session must not register for files in another Declared Project or a Dependency Project.

### Local feature services

Retained panels and commands consume a project-session interface rather than a manifest cache:

- editor intelligence delegates directly to the `LanguageClient`;
- compile and preview use dbt custom LSP commands where available;
- model and column lineage use `dbt.listNodes` or another verified local LSP command;
- run, build, test, clean, and unsupported LSP operations use the same resolved Fusion executable and Project Context;
- project trees prefer LSP data;
- artifacts are read only when the LSP lacks required data; and
- no independent timer or file watcher repeatedly runs `dbt parse`.

### Interaction policy

Startup is silent. Use the status bar, Problems, and Output for normal state. Show a notification only after a user invokes an action or when a blocking configuration error prevents the extension from starting.

If `innoverio.vscode-dbt-power-user` is installed, Fusion Power User reports one actionable conflict and does not start. It must not attempt to disable or modify another extension.

## Draft settings contract

All new settings use the `fusionPowerUser.*` namespace. Do not read legacy `dbt.*` values as fallbacks.

The implementation plan must finalize a small schema covering:

- `fusionPowerUser.dbtPath`;
- `fusionPowerUser.projects`;
- per-project profiles directory, profile, target, and optional environment file;
- LSP lint enablement, defaulting to true;
- local query row limits and retained panel preferences; and
- log level.

Settings that VS Code can scope to a resource must be declared with resource scope. Paths resolve from the workspace folder supplying the setting, not from the first workspace folder or extension-host process directory.

## Distribution and Consumer Repository contract

GitHub Releases publish a macOS-tested VSIX and checksum. A Consumer Repository pins both release and checksum. Setup:

1. skips the install when the requested extension version is already present;
2. removes the upstream Power User extension if installed;
3. downloads and verifies the VSIX;
4. installs it into Cursor and VS Code when each CLI exists; and
5. supports an explicit force reinstall.

The first Consumer Repository uses mise for the Fusion binary and mise-vscode for editor environment/path integration. The fork itself remains usable without mise.

## Research sources

- [dbt LSP overview](https://docs.getdbt.com/docs/about-dbt-lsp)
- [dbt MCP socket client](https://github.com/dbt-labs/dbt-mcp/blob/main/src/dbt_mcp/lsp/lsp_connection.py)
- [VS Code language client](https://github.com/microsoft/vscode-languageserver-node)
- [VS Code multi-server sample](https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-multi-server-sample)
- [Power User source](https://github.com/AltimateAI/vscode-dbt-power-user)
- [mise-vscode custom extension support](https://hverlin.github.io/mise-vscode/guides/custom-extensions/)
