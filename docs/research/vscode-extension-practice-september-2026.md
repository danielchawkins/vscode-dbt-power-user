# VS Code extension practice, late 2026 (LSP + CLI + webviews)

V = Verified (URL), I = Inferred.

## 1. Activation

- Contributed commands, views, languages, and custom editors activate the extension implicitly from 1.74; `onWebviewPanel:` is still required to restore panels. V: <https://code.visualstudio.com/api/references/activation-events>
- Avoid `*`; prefer `onStartupFinished`. V: same URL.
- Recommendation: register commands/providers synchronously; start the client and CLI probe without awaiting (`void start()`). I.

## 2. DI

- Inversify 8.x still requires `reflect-metadata` plus `experimentalDecorators`/`emitDecoratorMetadata`. V: <https://inversify.io/docs/introduction/getting-started/>
- TC39 standard decorators emit no parameter metadata, so this injection style needs the legacy flags. I.
- Recommendation: a plain composition root in `activate`; Microsoft samples use no DI library. I.

## 3. Disposables

- Every API resource returns a `Disposable`; `Disposable.from(...)` exists. V: <https://code.visualstudio.com/api/references/vscode-api>
- Pass `context.subscriptions` as the third argument to events. V: <https://code.visualstudio.com/api/extension-guides/webview>
- Recommendation: give each owner its own `DisposableStore` (VS Code's internal pattern). Only root objects go into `context.subscriptions`. `deactivate` returns `client.stop()`. V (stop/deactivate): <https://github.com/microsoft/vscode-languageserver-node/blob/main/README.md>

## 4. Configuration

- `getConfiguration(section, scope)` accepts Uri/TextDocument/WorkspaceFolder; `affectsConfiguration(section, scope)`. V: <https://code.visualstudio.com/api/references/vscode-api>
- `scope: "resource"` is required for per-folder settings; the default scope is `window`. V: <https://code.visualstudio.com/api/references/contribution-points>
- `contributes.languages` supports `filenamePatterns`. V: same URL.
- `configurationDefaults` overrides defaults of registered settings; docs are silent on `files.associations`, so prefer `filenamePatterns`. I.

## 5. Language client (10.x)

- v10 requires Node 22 and ES2022, publishes through `exports` (`module`/`moduleResolution: node16`), and requires a `LogOutputChannel` for output and trace channels. V: <https://github.com/microsoft/vscode-languageserver-node/blob/main/README.md>
- `start()`/`stop()` return promises; middleware covers requests, notifications, registration; default error handler restarts up to 5× in 3 min. V: same URL.
- The multi-root sample starts one server for each outermost workspace folder. V: <https://github.com/microsoft/vscode-extension-samples/tree/main/lsp-multi-server-sample>
- `createLanguageStatusItem` is the preferred way to show language status. V: <https://code.visualstudio.com/api/references/vscode-api>
- Recommendation: one client unless the server cannot handle multiple roots; restart = guarded `stop()` then `start()`. I.

## 6. Webviews

- The Webview UI Toolkit was archived on 2025-01-06. The maintainer points to `@vscode-elements/elements` (Lit) or vscrui (React, work in progress). V: <https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561>
- Start the CSP with `default-src 'none'`, allow `${webview.cspSource}`, avoid inline script and style, restrict `localResourceRoots`, and sanitize input. V: <https://code.visualstudio.com/api/extension-guides/webview>
- Prefer `getState`/`setState` to `retainContextWhenHidden`, which has high memory cost. V: same URL.
- Theme with `--vscode-*` variables and body classes; test high contrast. V: same URL.
- Bundle `@vscode/codicons` locally. I.

## 7. Bundling / ESM

- The docs show esbuild with `format: 'cjs'`, `external: ['vscode']`, and `tsc --noEmit` for type checking. V: <https://code.visualstudio.com/api/working-with-extensions/bundling-extension>
- The Node extension host loads `.mjs` or `"type":"module"` entry points from 1.100, per the maintainer (issue closed Jul 2026). The web worker host is still CJS. `vscode-languageclient` does not ship native ESM. V: <https://github.com/microsoft/vscode/issues/130367>
- Recommendation: ESM is viable for desktop-only extensions with `engines.vscode` ≥ 1.100; CJS output remains the lower-risk default. I.

## 8. Testing

- `@vscode/test-cli` plus `@vscode/test-electron` uses `.vscode-test.mjs` and Mocha. Separate labels support trusted and untrusted workspace runs. V: <https://code.visualstudio.com/api/working-with-extensions/testing-extension>
- Unit tests: keep domain logic free of `vscode` imports; run it under Vitest/Jest. I.
- fast-check: `fc.assert(fc.property(...))` for parsers; `fc.commands` for state machines. I.

## 9. Quality

- `strict-type-checked` suits TypeScript-proficient teams; not semver-stable. V: <https://typescript-eslint.io/users/configs/>
- typescript-eslint supports TypeScript `>=4.8.4 <6.1.0`, so it does not support TypeScript 7. V: <https://typescript-eslint.io/users/dependency-versions>
- TypeScript 7 (the native Go port) shipped in 2026. The typescript-go repository is archived, and the TypeScript 7 API was listed as "not ready". V: <https://devblogs.microsoft.com/typescript/> and <https://github.com/microsoft/typescript-go>
- Recommendation: type-check with TypeScript 7 `tsc` and keep TypeScript 6 for ESLint. I.
- Add sonarjs, knip for unused code, and dependency-cruiser for layer rules (`src/domain` must not import `vscode`). I.

## 10. Top anti-patterns (I unless noted)

1. `"*"` activation or awaiting heavy work in `activate` (V).
2. Leaked listeners and timers after a panel is disposed (V).
3. `retainContextWhenHidden` by default (V).
4. Inline scripts or a missing CSP (V).
5. Reading configuration without a resource scope in multi-root workspaces.
6. Shelling out through a shell string instead of `execFile` with arguments.
7. Continuing to use the archived webview toolkit (V).
8. Making the DI container the architecture: service locators and decorator metadata.
9. Floating promises from `sendNotification` (V: LSP README).
10. Bundling `vscode` or shipping unbundled `node_modules`.
