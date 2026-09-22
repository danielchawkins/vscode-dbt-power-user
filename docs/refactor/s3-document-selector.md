# S3: document selector and multi-root isolation

Evidence from npm tarballs of `vscode-languageclient@9.0.1` and `@10.1.1`, bundled `vscode-languageserver-protocol@3.17.5` and `@3.18.3`, and `@types/vscode@1.125.0` in the spike workspace. No editor was opened; nothing below is a live two-client, no-folder, or `target/` measurement.

## Question

Step 5.3 plans one `LanguageClient` per Declared Project with a `documentSelector` scoped to that project's root through a `RelativePattern`, so a multi-root window does not route one document to two Fusion servers. S3 asks whether that selector actually prevents two clients from both answering, and what happens for a file outside every workspace folder and for a `.sql` file under `target/`.

## Tarballs queried

| Package                          | Version | `engines.vscode` | Bundled / paired protocol                                   | Tarball SHA-256                                                    |
| -------------------------------- | ------- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `vscode-languageclient`          | 9.0.1   | `^1.82.0`        | `vscode-languageserver-protocol@3.17.5` (`package.json:33`) | `e235e4c6af4df40f54ce05bc3d0c4c788fb7ba58f8e34a0b20d30d7f8ef763b6` |
| `vscode-languageclient`          | 10.1.1  | `^1.91.0`        | `vscode-languageserver-protocol@3.18.3` (`package.json:47`) | `e07db4b051bb4df60d097bbbf1647b7f7b2ee7232bc852c403d589e748cd6018` |
| `vscode-languageserver-protocol` | 3.17.5  | —                | —                                                           | `7473eb2d2163f3f8bea09644f9d803789a195e596b65d3946c4157e583e3ccc8` |
| `vscode-languageserver-protocol` | 3.18.3  | —                | —                                                           | `7ea23f403fcd2678d8c220b749d225e59c03a14cd9269ce947304b5179e1769f` |

Neither language-client package declares `peerDependencies`. Both `engines.vscode` ranges include `1.128`, which satisfies this repository's `engines.vscode` `^1.128.0`.

Line citations below name paths inside the extracted package root (`lib/common/...` for the client; `lib/common/protocol.d.ts` for the protocol).

## Major 9 cannot express `RelativePattern` in `TextDocumentFilter`

Under protocol **3.17.5** (bundled with `@9.0.1`), `TextDocumentFilter.pattern` is `string` only (`vscode-languageserver-protocol/lib/common/protocol.d.ts:43-63`). A project-root `RelativePattern` cannot appear in a `LanguageClientOptions.documentSelector` filter at the protocol layer.

Protocol **3.18.0** introduces `GlobPattern` on `TextDocumentFilter.pattern` (`vscode-languageserver-protocol@3.18.3/lib/common/protocol.d.ts:31-93`, `@since 3.18.0`). `@10.1.1` depends on **3.18.3** (`package.json:47`) and converts those patterns in `asDocumentSelector` via `asGlobPattern` (`lib/common/protocolConverter.js:90-91`).

`GlobPattern` including `RelativePattern` existed in 3.17.5 for **file-system watchers** (`protocol.d.ts:1721-1728`), not for document filters. In `@9.0.1`, `asGlobPattern` (`lib/common/protocolConverter.js:1011-1024`) is called from `FileSystemWatcherFeature` only (`lib/common/fileSystemWatcher.js:35`), not from `asDocumentSelector` (`protocolConverter.js:36-57`, `:53-54` passes `filter.pattern` through unchanged). Major 9 does not convert `RelativePattern` document filters because it cannot receive them.

**Design consequence:** step 5.3's per-project `RelativePattern` selector requires **`vscode-languageclient` major 10**. Major 9 would invalidate this mechanism and require a different selector design (for example absolute string globs only, with the path-matching limitations that implies). **S6** owns the product pin and must satisfy its full host and install criteria; S3 establishes only this protocol constraint.

## `textDocuments.filters.relativePatternSupport`

Protocol `@3.18.3` documents that whether **clients** support relative patterns in filters depends on client capability `textDocuments.filters.relativePatternSupport` (`protocol.d.ts:43-45`, `:66-68`, `:89-91`; capability struct at `:1468-1474` under `TextDocumentClientCapabilities.filters` at `:481-486`).

That capability gates **server-supplied dynamic registration** of filters containing `RelativePattern`. Locally constructed `LanguageClientOptions.documentSelector` values are converted by the client's own `asDocumentSelector` and do **not** depend on the Fusion server advertising this flag.

## Fail-open when `RelativePattern` conversion fails (major 10 only)

In `@10.1.1`, `asGlobPattern` (`lib/common/protocolConverter.js:1110-1123`) returns `undefined` when:

- `pattern` is not a string and not an LSP `RelativePattern`; or
- `RelativePattern.baseUri` is an LSP URI string but `ls.URI.is` rejects the value (for example a live `vscode.Uri` object passed where the protocol type expects a URI **string**); or
- `baseUri` is an LSP `WorkspaceFolder` and `vscode.workspace.getWorkspaceFolder(...)` returns `undefined` (`:1118-1120`).

`asDocumentSelector` assigns `pattern: asGlobPattern(filter.pattern)` on each LSP `TextDocumentFilter` (`:73-92`, `:90-91`). A failed conversion yields `pattern: undefined`.

`@types/vscode@1.125.0` `languages.match` (`index.d.ts:14757-14761`) only rejects a filter part that is **defined** and fails to match; an unset `pattern` is not checked. A filter `{ language: 'jinja-sql', pattern: undefined }` therefore matches every `jinja-sql` document — **fail-open**, not fail-closed.

This path does not apply to major 9 document selectors: major 9 accepts only `string` `pattern` and cannot express project-root `RelativePattern` at all.

## What the library does (`@10.1.1`)

`LanguageClientOptions.documentSelector` uses the LSP-protocol `DocumentSelector` type. Registration converts selectors through `protocol2CodeConverter.asDocumentSelector` (for example `lib/common/features.js:161`, `lib/common/hover.js:88`, `lib/common/textSynchronization.js:100`).

### Text sync

**Change** (`DidChangeTextDocumentFeature`) gates on `languages.match` (`lib/common/textSynchronization.js:317`). **Close** (`DidCloseTextDocumentFeature`) gates on `languages.match` (`:228`).

**Save and will-save** live notifications (`DidSaveTextDocumentFeature`, `WillSaveFeature`, wired at `:519` and `:428`) gate on send through `TextDocumentEventFeature.matches` (`lib/common/features.js:176-180`), which calls `textDocumentFilter` (`:124-130`). The same `languages.match` predicate appears in `DynamicDocumentFeature.getState` (`:95-101`) when reporting whether a registration matches any open document. Converted selectors are stored on register (`:161`). **Will-save-until** uses the same filter directly (`textSynchronization.js:487`).

**Open** — default live `didOpen` uses the same `textDocumentFilter` path (`features.js:124-130` via `:176-180`; constructor at `textSynchronization.js:52`). Visibility applies only where the library checks it: register catch-up for already-open documents requires `languages.match(...) > 0` **and** `visibleDocuments.isVisible(textDocument)` (`:106-108`); with `delayOpenNotifications`, the live `DidOpenTextDocumentFeature.callback` also requires visibility before sending (`:65-66`).

### Language features

Features register through `vscode.languages.register*Provider(asDocumentSelector(selector), …)` (for example `lib/common/hover.js:88`). VS Code applies the selector before calling the provider.

### Pull diagnostics

For an open `TextDocument`, `DiagnosticFeature` matches only when **both** `languages.match(documentSelector, document) > 0` **and** `visibleDocuments.isVisible(document)` (`lib/common/diagnostic.js:644-647`). Notebook cells also require visibility of the notebook URI (`:649-651`).

URI-only pull paths use `matchFilter` / `matchGlobPattern` (`lib/common/diagnostic.js:624-625`, `lib/common/utils/globPattern.js:43-61`).

### Push diagnostics

`handleDiagnostics` queues by notification URI and does **not** re-check `documentSelector` (`lib/common/client.js:1361-1371`). In normal operation a server learns about a document through sync, but the library itself does not filter push notifications by selector.

## Two clients, one document

When two `@10.1.1` clients use **disjoint** converted selectors, only the client whose pattern matches should pass the `languages.match` gates above; the other should not sync, register an active provider, or pull diagnostics for that open document (pull diagnostics and certain open paths also require `visibleDocuments.isVisible`, as cited above).

When **both** selectors match the same document, both clients participate. Nested Declared Projects whose roots overlap under broad globs can match two `**/*` patterns unless the registry or selector excludes the overlap.

Overlapping selectors also affect editor-facing merge behavior (`@types/vscode@1.125.0`):

- **Hover** — `registerHoverProvider` (`index.d.ts:14951-14953`): multiple providers are asked **in parallel** and results are **merged**.
- **Definition** — `registerDefinitionProvider` (`index.d.ts:14900-14901`): same — parallel, merged.
- **Document formatting** — `registerDocumentFormattingEditProvider` (`index.d.ts:15088-15090`): providers are sorted by `languages.match` score and the **best-matching** provider is used; no tie-break is documented when scores are equal.

Completion and several other features merge or order by score per their own `register*` docs in the same namespace. Overlap can therefore produce duplicated or merged hovers/definitions, merged completion lists, or ambiguous formatting winner selection — not silent single-client isolation.

The library reading supports step 5.3's intent for disjoint roots in a multi-root window but does not prove it empirically.

## File open with no workspace folder

Behavior depends on how the LSP `RelativePattern` base is encoded **before** conversion (major 10 only).

### `WorkspaceFolder` base

When `baseUri` is an LSP `WorkspaceFolder`, conversion calls `vscode.workspace.getWorkspaceFolder` (`lib/common/protocolConverter.js:1118-1120`). If the open file's URI is not under any opened workspace folder, lookup can fail even when the path is physically inside a Declared Project tree on disk. Failed conversion yields `pattern: undefined` and the fail-open language-wide filter described above — not a clean non-match.

### String URI base

When `baseUri` is an LSP URI **string** (`ls.URI.is` true, `:1115-1116`), conversion builds `new vscode.RelativePattern(asUri(stringUri), pattern)`. VS Code `RelativePattern` accepts a `Uri` base for paths outside workspace membership (`index.d.ts:2342-2344`). Library reading therefore allows a selector to match a file physically under the Declared Project root even when that file is not in any workspace folder. **Not run:** live File → Open on such a path.

Push diagnostics could still land without sync if a server sent them; pull diagnostics for open documents still require visibility.

## `.sql` under `target/`

A `RelativePattern` rooted at the Declared Project matches `target/compiled/.../model.sql` on **path** when the glob includes it (for example `**/*`).

`languages.match` also requires every **set** filter field to agree (`index.d.ts:14757-14761`). `{ language: 'jinja-sql', pattern: RelativePattern(root, '**/*') }` does not match a compiled artifact whose `languageId` is `sql`. A selector without `language`, or with separate filters for `jinja-sql` and `sql`, matches on path. This repository does not associate `target/**` in `files.associations`; effective language id for an opened compiled file is **not run** here.

Compiled SQL under `target/` is engine output. Whether Fusion LSP should serve it is a product choice separate from whether the selector matches it.

## Unmeasured in this run

| Scenario                                                             | Status                                 |
| -------------------------------------------------------------------- | -------------------------------------- |
| Two Fusion `LanguageClient`s in one multi-root window, same document | **Not run** — no editor launched       |
| File opened outside every workspace folder (either base kind)        | **Not run** — library/API reading only |
| `.sql` under `target/`, effective `languageId` and LSP response      | **Not run**                            |
| Nested Declared Project roots where paths overlap                    | **Not run**                            |

## Implication for step 5.3

Per-project isolation through `RelativePattern` is plausible on **major 10** when converted selectors are disjoint and pattern-bearing, but fail-open conversion and overlapping merge semantics are real risks. Any product pin below major 10 invalidates this selector mechanism; **S6** must pin major 10 or step 5.3 needs a different design.

Step 5.3 should:

1. Build LSP `RelativePattern` filters with a **URI string** base (`file:///...` for the Declared Project root), not a live `vscode.Uri` object and not a `WorkspaceFolder` handle unless the root is exactly that workspace folder and `getWorkspaceFolder` is guaranteed.
2. **After `asDocumentSelector` (major 10 only)**, assert or validate that every filter retains a non-undefined `pattern` before the client registers; treat missing pattern as a construction bug, not a scoped selector. This guard does not apply to major 9, which cannot express `RelativePattern` in `TextDocumentFilter` anyway.
3. Narrow globs when roots can nest; exclude `target/` explicitly if compiled artifacts must not sync.
4. Treat S3 as undischarged until a live two-client check runs.

This document does not discharge S3.
