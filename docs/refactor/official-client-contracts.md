# Official dbt Fusion Client Contracts

## Evidence Source

- Artifact: dbtLabsInc.dbt VSIX 0.107.8
- SHA-256: `46e997f0cf8fd7fd2d3aa2062ad33cb30b20048a8a4e3b0712fd58b630e7fdac`
- Fusion: 2.0.6 for the official-client capture; target isolation also reproduced on 2.0.5
- Captured: 2026-09-22

The official-client findings combine static inspection of the VSIX bundle with a temporary redacted launch proxy. The proxy retained argument names, environment-key names, methods, and outcomes only; raw values and temporary files were deleted under the spike privacy rules. Claims below identify behavior observed through that run or reproduced by checked-in tests. The "Argument Shapes" section below (2026-09-23) is a second static pass over the unminified, locally installed `dbtlabsinc.dbt-0.104.0-universal` extension bundle (`~/.cursor/extensions`), read-only and not copied into this repository.

## Spawn Environment and Working Directory

The official extension bundle and launch proxy establish:

- **Working Directory:** Spawn cwd is always set to the project root (the directory containing `dbt_project.yml`). Profile resolution depends on cwd when no explicit `--profiles-dir` is provided.
- **DBT_LSP_USE_TARGET_LSP=1:** The official client always sets `DBT_LSP_USE_TARGET_LSP=1` in the spawn environment, overriding any inherited or configured value.
- **Target Path Behavior:** With `DBT_LSP_USE_TARGET_LSP=1`, compilation writes under `target/.lsp` and `clearTarget` removes only `target/.lsp`. A repository integration test reproduced this on Fusion 2.0.5 and 2.0.6 while preserving seeded `target/manifest.json` and `target/compiled`. Without the variable, S7 observed compilation under `target/compiled` and `clearTarget` deleting the entire target directory.

This isolation prevents the LSP from corrupting manifest-driven artifact paths, which is critical when this extension and an external tool share the same `dbt_project.yml` directory.

## Workspace Configuration Protocol

The official client receives `workspace/configuration` requests with `[{section:"dbt"}]`. The Fusion LSP in production expects a minimal response:

```json
{
  "lsp": {
    "linter": {
      "enabled": true|false
    }
  }
}
```

Fusion Power User returns only this shape so another extension's `dbt.*` settings cannot configure its server process.

## Compile and Clear Target Semantics

- **First didOpen triggers compile:** The official client does not send explicit `compileLsp` in production. The first `didOpen` for a file in the project automatically triggers a compile.
- **No automatic bootstrap:** Neither `compileLsp` nor `clearTarget` are sent at startup or after configuration change; they are explicit user-invoked operations only.
- **clearTarget is explicit:** The user must choose to clear the target; the extension never invokes it automatically.

## Advertised Providers and Capabilities

As observed on Fusion 2.0.6 `initialize` response:

**Advertised Providers:**

- `completionProvider` — inline completions
- `hoverProvider` — hover hints
- `definitionProvider` — go to definition
- `referencesProvider` — find all references
- `renameProvider` — rename symbol
- `signatureHelpProvider` — function signature hints
- `documentFormattingProvider` — format document
- `documentSymbolProvider` — document symbols
- `codeActionProvider` — refactor actions
- `codeLensProvider` — inline code lenses
- `semanticTokensProvider` — syntax highlighting
- `inlayHintProvider` — inline type hints

**Diagnostics:** `diagnosticProvider` was absent. S1 and S10 observed no `textDocument/publishDiagnostics`, so diagnostic timing remains unverified.

**Supported Commands (from `executeCommandProvider`):**

- `dbt.listNodes` — project lineage
- `dbt.getCurrentNode` — column-level metadata
- `dbt.compileFile` — compile a single file
- `dbt.compileLsp` — compile the whole project (not sent in production)
- `dbt.clearTarget` — remove target artifacts (explicit user action only)
- `dbt.getProjectInfo` — project metadata (name, target, paths, adapter)
- `dbt.show` — execute a SELECT statement

**Not Advertised:**

- `dbt.previewCte` and `dbt.goToDefinition` are not in the advertised list. The server returned `null` when they were executed. The official-client capture observed bare `dbt.previewCte` commands in code lenses, so Fusion Power User must rewrite those lenses to a fork-owned command ID.

## Progress Notifications

Fusion uses `window/workDoneProgress/create` and `$/progress`. The `dbt/progress/*` strings are progress tokens, not notification methods. Captured or statically identified tokens relevant to retained features are:

- `dbt/progress/listNodes` — "Computing Lineage"
- `dbt/progress/getCurrentNode` — "Getting Columns"
- `dbt/progress/compileFile` — "Compiling File"
- `dbt/progress/show` — "Running Preview"

`vscode-languageclient` handles standard work-done progress.

## Diagnostics Policy

The server did not advertise pull diagnostics. Fusion Power User initially passes standard push diagnostics through unchanged; dependency filtering is added only if a production-shaped test demonstrates harmful noise.

## Known Symlink Hazard

The editor capture showed Fusion canonicalizing `--project-dir` but not document URIs. A project opened through a symlink may therefore fail to trigger compilation on `didOpen`. This is a known server-path limitation; this correction does not add path rewriting. Reproduced directly in `src/test/integration/fusionEditorFlowsCapture.test.ts`'s `probeSymlinkedRoot` (2026-09-23): the same code path against a real `--project-dir` reaches `getProjectInfo.models_count:7, is_estimate:false` 8s after `didOpen`, while a `--project-dir` pointed at a symlink to that identical temp copy, opened with document URIs built from the symlink, stays at `models_count:0, is_estimate:true` after the same wait. This is an **open product finding**, not fixed here: `src/lsp/fusionLanguageClient.ts:577` builds the document selector from `project.root`, `:585` passes `project.root.fsPath` as `--project-dir`, and `:603` passes the same unmodified path as spawn `cwd`; document URIs VS Code sends for files under a symlinked workspace folder keep the symlinked path, so a Consumer Repository workspace opened through a symlink may never compile on `didOpen`.

## Argument Shapes (static bundle inspection, dbtLabsInc.dbt-0.104.0-universal, 2026-09-23)

Static inspection of the installed, unminified `dbtlabsinc.dbt-0.104.0-universal` extension (`~/.cursor/extensions`, `dist/extension.js`) recovered the exact `workspace/executeCommand` argument shapes the official client sends, resolving the "Unresolved" rows the loaded-DuckDB probes above had left open. All commands other than `getCurrentNode` are sent with the client's `customCommandPrefix` prepended to the literal string `dbt.<name>`; `getCurrentNode`'s call site builds its command name from the bare literal `dbt.getCurrentNode` only, omitting `customCommandPrefix` (`lspGetCurrentNode`, next to `lspListNodes` and `supportsCommand` in the same class) — an asymmetry in the official client itself, not something Fusion Power User needs to reproduce when its own prefix is applied consistently everywhere.

- **`dbt.listNodes`**: arguments are `[selector]`, not `[]`. `selector` is a dbt node-selector string built by `YLt(nodeOrPath, {includeParents, includeChildren, depth})`, which returns `${depth}+${nodeOrPath}${'+'}${depth}` style syntax (`+` alone at depth 0, e.g. `+models/child.sql+` for a project-relative file path with both flags true). The caller (`refreshForFile`) passes the didOpen'd file's path relative to the project root; the lineage-panel caller passes a node's `unique_id` instead of a path. A second, optional argument (`lineageFilter`) is included only when truthy (`[e,t].filter(Boolean)`).
- **`dbt.getCurrentNode`**: arguments are `[relativePath]` — a bare project-relative path **string**, not `{uri,line,character}`. No line/character position is sent at all; the command returns node-level (not cursor-level) data, and callers use `node.columns`/`node.unique_id`/`node.static_analysis` from the result.
- **`dbt.compileFile`**: arguments are `[uriString]` — `Uri#toString()` of the document, a bare string — confirming the loaded-DuckDB probe's finding that only the string shape (not an object) returns compiled output.
- **`dbt.show`**: arguments are `[{uri, inline, limit}]`, matching the already-documented shape; `inline` carries the selected SQL text for a preview-selection call and is otherwise `undefined`.
- **`dbt.getProjectInfo`**: sent with no `arguments` key at all (`{command}` only, not even `arguments:[]`).

**Hover has no client-side path for macros.** The bundle's only `middleware` entries are `workspace.configuration` (rewrites per-item `workspace/configuration` responses) and, gated behind `dbtMajorVersion === "v1"` (dbt Core, not Fusion), a `handleDiagnostics` middleware that drains non-root-project diagnostics into a single summary diagnostic on the root project file. There is no `middleware.provideHover`, no macro-specific request, and no custom `dbt/*` hover method; `HoverFeature.registerLanguageProvider` is unmodified `vscode-languageclient` library code that calls plain `textDocument/hover` and falls through to the LSP result when no middleware overrides it. A `null` result from Fusion for a macro-call hover is therefore returned to the official client's UI unmodified, with no fallback — the official client gets exactly what our client gets for the same request.
