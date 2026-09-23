# Fusion LSP feature disposition

This inventory defines the comprehensive Fusion Power User target. A feature listed for retention may land after the first alpha; release sequencing lives in [`fusion-lsp-plan.md`](fusion-lsp-plan.md).

The implementation agent must verify every entry against the current branch before deleting code. Features often share dependency-injection bindings, commands, webview routes, message contracts, and package contributions.

## Replace with native dbt LSP

Delete the existing implementation after the corresponding LSP capability has characterization and integration coverage:

- model, source, macro, function, and doc-block completion;
- hover;
- go to definition and references;
- rename;
- signature help;
- SQL and Jinja diagnostics;
- semantic tokens and inlay hints;
- SQL formatting;
- lint diagnostics and fix-all code actions;
- code lenses that duplicate native LSP lenses; and
- file-rename edits.

Likely source areas:

- `src/autocompletion_provider/`
- `src/definition_provider/`
- `src/hover_provider/`
- `src/document_formatting_edit_provider/`
- manifest-cache consumers under `src/dbt_client/` (standard LanguageClient diagnostics are separate)

Do not keep an old provider as a silent fallback. Duplicate providers make completion ordering, diagnostics, formatting, and navigation nondeterministic.

## Retain with a local LSP or Fusion CLI backend

These are part of the target product:

- compile the active model or selected SQL;
- preview compiled SQL;
- execute and preview a query;
- run, build, test, and clean projects or selected nodes;
- run parent, child, and combined graph selections;
- model-level lineage;
- column-level lineage when the local Fusion LSP exposes the required data; remove the current hosted implementation and rebuild the local contract rather than retaining its API client;
- parent, child, test, and documentation trees;
- query results, export, tables, charts, and analysis;
- CTE preview and profiling;
- local documentation editing and YAML updates;
- local model generation from sources where no hosted model is involved;
- defer and state configuration supported by Fusion;
- target/profile selection;
- diagnostics collection and local debug logs; and
- snippets and dbt-oriented SQL/Jinja language presentation.

Backend priority:

1. standard LSP request or notification;
2. typed dbt custom LSP command;
3. read-only Fusion artifact;
4. direct local Fusion CLI command.

The implementation must record why it drops to a lower tier. It must not create a second project parser.

Likely source areas:

- `src/commands/`
- `src/code_lens_provider/`
- `src/content_provider/`
- `src/cte_profiler/`
- `src/treeview_provider/`
- `src/webview_provider/queryResultPanel.ts`
- `src/webview_provider/lineagePanel.ts`
- `src/webview_provider/newLineagePanel.ts`
- `src/webview_provider/docsEditPanel.ts`
- retained modules under `webview_panels/src/modules/`

## Remove

Remove the feature, its commands and settings, dependency-injection bindings, assets, webview routes, tests, network clients, package contributions, and dependencies:

- Altimate account, API key, instance, URL, and authentication flows;
- DataPilot and other chat or agent experiences;
- AI query explanation, rewriting, translation, model generation, test generation, and documentation generation;
- collaboration, conversations, comments, and hosted sharing;
- MCP server and MCP walkthroughs;
- notebooks and Jupyter kernels;
- telemetry and analytics;
- hosted governance, insights, scans, and project health checks;
- hosted query history and bookmarks;
- hosted dbt docs links and SaaS views;
- BigQuery-specific cost estimation;
- dbt Cloud integration;
- dbt Core, Core Command, Python bridge, interpreter detection, and Python diagnostics;
- extension-managed dbt installation or updates;
- setup walkthroughs, changelog prompts, API-key prompts, and unsolicited recommendations;
- recurring hosted polling and update checks; and
- commands whose only implementation is an unavailable hosted endpoint.

Likely source areas:

- `src/altimate.ts`
- `src/comment_provider/`
- `src/mcp/`
- `src/notebook/`
- `src/telemetry/`
- `src/commands/datapilot*`
- `src/commands/conversation*`
- `src/webview_provider/altimateWebviewProvider.ts`
- `src/webview_provider/insightsPanel.ts`
- `src/webview_provider/newDocsGenPanel.ts`
- hosted and AI modules under `webview_panels/src/modules/`
- Python files and packaged Python dependencies
- Altimate documentation, images, walkthroughs, and localization strings

## Resolve with focused spikes

### Dependency diagnostics

Observe dbt Fusion's normal behavior with:

- a healthy installed package;
- a package containing lint violations;
- a package containing a parse error that blocks the root project;
- a local package; and
- a cross-project reference.

Prefer normal Fusion behavior. If dependency diagnostics overwhelm editable files, suppress dependency-file squiggles while preserving one actionable project-level blocker. Do not hide a failure that prevents the Declared Project from loading.

### Lineage

Verify the shape and stability of `dbt.listNodes`, column selectors, compile-complete notifications, and any required static-analysis setting. Keep the existing local lineage webview only after its data contract is detached from Altimate responses. The current table graph is manifest-backed and local; the current column graph calls Altimate. Treat them as separate migrations.

### Documentation editor

Separate local YAML editing from collaboration, hosted metadata, AI generation, and dbt docs URLs. The first complete beta includes the local editor. If the current message contracts cannot be separated safely, define a smaller local contract rather than retaining hosted abstractions.

### Query analysis

Trace query results, CTE profiling, charts, exports, history, and bookmarks independently. Keep execution, analysis, charts, and exports locally. Retain history or bookmarks only if storage is local, bounded, and contains no hosted identity assumptions.

### Model generation

Keep deterministic generation from local source metadata. Remove generation that calls AI or hosted endpoints.

### Artifacts

List each retained artifact read and the missing LSP field that requires it. Delete manifest watchers and periodic parse jobs after all consumers move to project-session APIs.

## Dependency direction

Expected removals include:

- `@altimateai/dbt-integration` after all retained operations have native local adapters;
- `@modelcontextprotocol/sdk`;
- Jupyter and nteract packages;
- `@vscode/chat-extension-utils`;
- `@vscode/extension-telemetry`;
- Python bridge, ZeroMQ, and packaged Python trees;
- hosted HTTP and WebSocket dependencies that have no local consumer; and
- extension dependencies on Python and the Altimate MCP extension.

Expected additions include:

- `vscode-languageclient`;
- only the minimal test dependencies needed for socket lifecycle and extension-host integration.

Expected retention includes:

- VS Code APIs and dependency injection while they still reduce migration risk;
- webview infrastructure needed by retained local panels;
- `semver` for Fusion compatibility;
- YAML support needed by local documentation editing; and
- process/path utilities needed by the local executable resolver.

Do not remove a dependency from `package.json` until source search, build, unit tests, and VSIX smoke tests prove it unused.

## Removal order constraints

These current couplings make deletion order part of correctness:

1. `DBTFusionCommandProjectIntegration` inherits Cloud behavior. Extract local run, build, test, compile, defer, and JSON-log parsing before removing authentication and hosted validation.
2. Fusion detection and CLI execution depend on the Python environment abstraction. Replace both before removing Python code or `ms-python.python`.
3. Add and characterize the native LSP before deleting any completion, hover, definition, validation, or formatting provider.
4. Keep the manifest watcher only for named local panel consumers. Migrate those consumers behind a project-session interface before deleting the parser.
5. Separate query-results and lineage webviews from shared Altimate base classes before removing hosted webview libraries.
6. Remove the exposed `generateDBTDocs` command early: the current Fusion implementation throws because docs generation is unsupported.
7. Constructor-time credential validation is removed (was hosted validation in ValidationProvider).

## Package identity and contributions

Change:

- package name to `fusion-power-user`;
- publisher to `danielchawkins`;
- display name to `Fusion Power User`;
- command IDs, view IDs, context keys, configuration keys, and URI schemes to a `fusionPowerUser` namespace;
- repository, homepage, bugs, icons, descriptions, and keywords; and
- every user-visible reference to Altimate or Power User's hosted product.

Remove upstream extension dependencies. Syntax highlighting ships under this extension's identity: a contributed `jinja-sql` grammar and YAML injection grammar; no Better Jinja dependency.

The extension must detect `innoverio.vscode-dbt-power-user`. When present, it emits one blocking, actionable error and does not activate project services.
