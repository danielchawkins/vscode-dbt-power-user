# Webview Content Security Policy — evidence, October 2026

Every panel page comes from `panelHtml` (`src/webview/panelHtml.ts`). The policy starts from `default-src 'none'`; `contentSecurityPolicy` adds the shared allowances, and each panel adds the ones listed under its name below. The pinned-host smoke (`src/test/smoke/panelSmoke.test.ts`) fails a panel that logs a Content Security Policy message, and it renders a two-row result in the query results panel's Perspective grid.

## Shared allowances

| Directive                               | Why                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `script-src 'nonce-…' <cspSource>`      | The nonce admits the entry script; `cspSource` admits the chunks it imports with `import()`.        |
| `style-src <cspSource> 'unsafe-inline'` | `main.css` and `codicon.css`, plus the inline styles react-select (Emotion) and Perspective inject. |
| `font-src <cspSource>`                  | `codicon.ttf`. The bundle has no `@font-face` with a `data:` source, so `data:` was removed.        |
| `img-src <cspSource> data:`             | `spinner.gif` and the SVG, PNG and GIF data URIs in `main.css` (374, 6 and 12 in the build).        |

Removed from the previous two policies: `'unsafe-eval'`, `https:` in `img-src`, the `https://*.vscode-resource.vscode-cdn.net` script source (covered by `cspSource`), and `data:` in `font-src`.

## Perspective

Perspective 3 fetches `perspective-server.wasm` and `perspective-viewer.wasm` from the asset root, compiles them, and starts its engine in a module worker created from a `Blob` URL. With the one shared bundle, every panel's page runs that initialisation on load, so every page needs these three allowances until each panel has its own entry.

Each row below is one VS Code 1.128.0 smoke run with only that allowance removed from the policy above.

| Removed                                            | Result                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `'unsafe-eval'` (replaced by `'wasm-unsafe-eval'`) | Passes. The grid shows `n label 1 one 2 two`; no CSP messages on any panel.                                                             |
| `'wasm-unsafe-eval'`                               | `WebAssembly.compile()` throws `CompileError: … 'unsafe-eval' is not an allowed source of script`; `<perspective-viewer>` never mounts. |
| `worker-src blob:`                                 | `Creating a worker from 'blob:vscode-webview://…' violates … script-src`; the viewer mounts with an empty grid.                         |
| `connect-src <cspSource>`                          | `Connecting to '…/perspective-server.wasm' violates … default-src 'none'` and the same for `perspective-viewer.wasm`.                   |

The `Function(...)` calls in the built bundle are wasm-bindgen's `__wbg_newnoargs` glue and Perspective's single-threaded fallback. Neither runs on the path above, and no panel logs an `'unsafe-eval'` violation without it.

Perspective's themes set `--map-tile-url` to `http://{a-c}.basemaps.cartocdn.com/…` for its map plugins. The policy blocks those tiles by design: no remote origin is allowed, and the bundle registers only the datagrid and d3fc plugins, which draw no tiles.
