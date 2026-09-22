# S5: coexistence with the official dbt extension

Captured 2026-09-21. Static comparison of manifest contribution points, a bundle read of the official extension, and a source read of `vscode-languageclient` 10.1.1. No editor was launched, no extension was installed, and no side-by-side run was performed.

## Source compared

| Field                                          | Value                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Marketplace id                                 | `dbtLabsInc.dbt` (publisher `dbtLabsInc`, extension name `dbt`; the spike brief names `dbtlabs.dbt`) |
| Version                                        | `0.107.8`                                                                                            |
| Bundled LSP version (`lspVersion` in manifest) | `2.0.6`                                                                                              |
| Fusion Power User version                      | `0.2.0-alpha.0` (`package.json` in this repo)                                                        |

## Provenance

Official manifest extracted from the VS Marketplace VSIX downloaded to `/tmp` and deleted afterward.

| Artifact                | URL or command                                                                                                       | SHA-256                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| VSIX (gzip transport)   | `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/dbtLabsInc/vsextensions/dbt/0.107.8/vspackage` | `12c0c010ef9b68b4ecda56c7cd5c6615a6e48ca44aca1d9bcb7e7855494a436a` |
| VSIX (after `gzip -dc`) | same URL, decompressed locally                                                                                       | `46e997f0cf8fd7fd2d3aa2062ad33cb30b20048a8a4e3b0712fd58b630e7fdac` |

`vscode-languageclient` 10.1.1 was read from an `npm pack` extract (`lib/common/executeCommand.js`). Fusion Power User does not depend on it yet; step 5.2 will add it.

## Method

1. Read Fusion Power User `package.json` `contributes` and grep `src/` for `registerCommand` / `registerTextEditorCommand`.
2. Download `dbtLabsInc.dbt` `0.107.8`, hash the artifact, extract `extension/package.json`, and grep `extension/dist/extension.js` for LSP launch and `workspace/executeCommand` usage.
3. Compare manifest contribution ids and names statically.

## S5 verdict

Static comparison is **partial**. It does **not** choose between coexistence via `--command-prefix` and a second conflict guard; that remains for step 5.3 after sibling spikes converge.

**Open live gates:** side-by-side duplicate diagnostics, duplicate VS Code command registration when two LSP clients are active, TextMate highlighting merge behavior, and runtime `files.associations` / language-id assignment.

## VS Code command palette ids (manifest)

Palette command ids are scoped to `contributes.commands` in each manifest. Neither manifest declares overlapping ids.

| Extension         | Manifest command id pattern                                                                | Manifest count |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------- |
| Official dbt      | `dbt.*` (e.g. `dbt.runModel`, `dbt.compileFile`, `dbt.showProjectLineage`)                 | 42             |
| Fusion Power User | `dbtPowerUser.*` (e.g. `dbtPowerUser.runCurrentModel`, `dbtPowerUser.compileCurrentModel`) | 36             |

Fusion Power User runtime registration was checked in `src/`: all 36 manifest ids appear in `registerCommand` / `registerTextEditorCommand` calls. Nine additional runtime-only ids were found (`dbtPowerUser.associateFileExts`, `dbtPowerUser.pickProject`, and seven others); `dbtPowerUser.associateFileExts` is a runtime command only — it is not in `contributes.commands`. Official runtime registration beyond the 42 manifest ids was not fully enumerated.

These palette ids are workbench commands (`vscode.commands.registerCommand`), not the LSP `workspace/executeCommand` names discussed below.

## LSP execute commands and VS Code registration

Each extension runs its own `dbt lsp` process. Prefix namespaces are per server process, not shared across extensions.

The plausible collision is **`vscode-languageclient` registering each server-advertised `executeCommandProvider.commands` entry into VS Code's command registry**. In `vscode-languageclient` 10.1.1 `ExecuteCommandFeature.initialize`, the client copies `capabilities.executeCommandProvider` from the server's `initialize` response and, for each string in `commands`, calls `vscode.commands.registerCommand(command, …)` (`lib/common/executeCommand.js`, lines 61–90). Two clients whose servers advertise the same command id would therefore compete for the same VS Code registration. This spike read that source only; it did not run two clients to observe registration failure or last-writer behavior.

Fusion Power User has no LSP client yet. When added (step 5.3), a server launched without `--command-prefix` advertises bare `dbt.*` execute commands (`dbt.listNodes`, `dbt.getCurrentNode`, `dbt.compileFile`, `dbt.compileLsp`, `dbt.clearTarget`, `dbt.getProjectInfo`, `dbt.show`; see `docs/refactor/lsp-commands.md`). Those are the ids `ExecuteCommandFeature` would register unless the launch uses a prefix.

### S2 prefix semantics (relevant to registration, not shared server state)

S2 on Fusion 2.0.5 established that `--command-prefix` uses **raw concatenation with no separator**: prefix `fusion` yields advertised ids like `fusiondbt.listNodes`. On that run the server still **accepted** a manually sent bare `dbt.getProjectInfo` RPC and returned `{}`, while `fusiondbt.getProjectInfo` also returned `{}` and `fusion.getProjectInfo` matched an unknown command. **Client registration follows the advertised command list from `initialize`; a server accepting a bare RPC does not prove the client registers bare ids.**

### Official extension prefix

In `extension/dist/extension.js` (`dbtLabsInc.dbt` `0.107.8`, VSIX hash verified above), each LSP client launch assigns a per-client prefix and passes it to the spawn arg builder. There is **no leading space** in the generated value; the trailing colon is inside the template literal and therefore inside the raw `--command-prefix` argv token:

```javascript
P = `${crypto.randomUUID()}:`,
v = tki({
  projectDir: e.fsPath,
  // ...
  commandPrefix: P,
  // ...
});
```

```javascript
function tki({ /* ... */ commandPrefix: o, /* ... */ }) {
  let d = ["lsp", "--project-dir", r];
  // ...
  d.push("--command-prefix", o);
  // ...
}
```

**Exact prefix shape:** `<uuid>:` where `<uuid>` is one `crypto.randomUUID()` value and the colon is the final character of the `--command-prefix` argument (raw concatenation with S2 semantics → advertised ids like `<uuid>:dbt.listNodes`).

The wrapper stores `P` as `customCommandPrefix`. Most outbound `workspace/executeCommand` calls use `` `${customCommandPrefix}${We}.${name}` `` with `We = "dbt"`, e.g. `<uuid>:dbt.listNodes`. The server's `initialize` list should therefore advertise prefixed ids, and `ExecuteCommandFeature` should register those prefixed ids — not bare `dbt.*`.

### Bare `dbt.getCurrentNode` call site (unknown routing)

Static grep found this minified method body; it does **not** establish that the call succeeds against a prefixed server, or that bare `dbt.getCurrentNode` is registered in VS Code. Other LSP sends in the same class use the prefixed form. This is noted as an open static observation, not part of the overlap verdict below.

```javascript
async lspGetCurrentNode(e) {
  let t = `${We}.getCurrentNode`;
  return await this.client.sendRequest("workspace/executeCommand", {
    command: t,
    arguments: [e],
  });
}
```

Fusion Power User has not added an LSP client; its planned command set (step 5.3) includes `getCurrentNode` and may include `previewCte`.

## Language and grammar contributions

Both extensions contribute the same language id and primary grammar scope. Injection targets do **not** overlap.

| Contribution                            | Official dbt `0.107.8`                                                                                                 | Fusion Power User `0.2.0-alpha.0`      | Overlap     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------- |
| Language id                             | `jinja-sql`                                                                                                            | `jinja-sql`                            | Yes         |
| Primary grammar                         | `jinja-sql` → `source.sql.jinja`                                                                                       | `jinja-sql` → `source.sql.jinja`       | Yes         |
| Injection grammars                      | `dbt.jinja-sql.injection`, `dbt.funcsign.injection`, `sql.function.injection` into `source.sql` and `source.sql.jinja` | `source.yaml.jinja` into `source.yaml` | **None**    |
| `contributes.languages[].configuration` | absent                                                                                                                 | absent                                 | n/a         |
| Snippets                                | `sql`, `jinja-sql`                                                                                                     | `jinja-sql`                            | `jinja-sql` |

Both extensions bind the same `jinja-sql` language id and the same primary `scopeName` (`source.sql.jinja`). VS Code merges extension grammars for a shared language id; **which TextMate rules win for highlighting is unmeasured** in this spike. The shared id does not by itself assign a buffer's `languageId` — that depends on file association and editor mode, also unmeasured.

### Activation events (manifest only)

Official `activationEvents` in `extension/package.json`:

```json
["onLanguage:sql", "workspaceContains:**/dbt_project.yml", "workspaceContains:**/dbt_project.yaml"]
```

Fusion Power User:

```json
["workspaceContains:**/dbt_project.yml"]
```

The official manifest includes **both** `dbt_project.yml` and `dbt_project.yaml` workspaceContains arms, plus `onLanguage:sql`. This spike read the manifest only; it does not infer runtime activation timing from these strings alone.

## `files.associations`

Neither manifest contributes `contributes.files.associations`.

Fusion Power User registers `dbtPowerUser.associateFileExts` at runtime; it opens the user settings UI filtered to `files.associations` and does not declare associations in the manifest. The official bundle contained no `files.associations` string in `package.json` or a quick grep of `extension.js`. Runtime association behavior was not measured.

## Configuration keys

Both use the `dbt.*` settings namespace but register different property ids. No property id is duplicated between the two manifests (official: `dbt.dbtPath`, `dbt.formatOnSave`, `dbt.lsp.linter.enabled`, etc.; Fusion Power User: `dbt.enabled`, `dbt.projects`, `dbt.altimateAiKey`, etc.). Shared prefix only; not a contribution-point id collision.

## What was not measured

- Side-by-side install of official dbt and a Fusion Power User dev build in one window.
- Duplicate diagnostics from two LSP clients on the same document.
- Duplicate VS Code command registration when two LSP clients advertise overlapping execute-command ids.
- Runtime `files.associations` or language-id assignment for `.sql` model files.
- TextMate grammar merge / highlighting when both extensions contribute `jinja-sql`.
- User-facing conflict guards (step 1.3 covers upstream Power User only).

## Static overlap summary

| Area                                        | Static overlap                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manifest VS Code command ids                | None                                                                                                                                                                                                                                                                                                                              |
| LSP execute commands → VS Code registration | **Unknown live**; mechanism: `ExecuteCommandFeature` registers each id from the server's advertised list. Official server uses per-client `{uuid}:` prefix (raw concat → `{uuid}:dbt.*`). Fusion planned bare `dbt.*` unless step 5.3 adds prefix. Overlap requires both clients to advertise the same id — not shown statically. |
| Language id / primary scopeName             | `jinja-sql` and `source.sql.jinja`                                                                                                                                                                                                                                                                                                |
| Injection grammars                          | None (SQL vs YAML inject targets)                                                                                                                                                                                                                                                                                                 |
| `files.associations`                        | None in either manifest                                                                                                                                                                                                                                                                                                           |
| Duplicate diagnostics                       | Not measured                                                                                                                                                                                                                                                                                                                      |
