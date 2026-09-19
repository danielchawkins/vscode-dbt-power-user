# VS Code extension development evidence ledger

Accessed 2026-09-19 unless stated otherwise. “Updated” is omitted when the publisher exposes no reliable page date. For undated VS Code API pages, applicability was checked against VS Code 1.137 and current official sample/tooling repositories. Quotations preserve source wording; elisions are marked.

## Product and runtime baselines

### [1] Visual Studio Code 1.137

- Publisher: Microsoft, Visual Studio Code
- Published: 2026-09-09
- Type: official release notes
- URL: <https://code.visualstudio.com/updates/v1_137>
- Location: title and opening release metadata
- Quote: “Visual Studio Code 1.137” and “Release date: September 9, 2026”
- Supports: VS Code stable baseline on the research date.

### [2] VS Code 1.137 runtime pins

- Publisher/repository: Microsoft, `microsoft/vscode`
- Published tag: `1.137.0`; release commit installed locally: `645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`
- Type: primary source
- URLs:
  - <https://raw.githubusercontent.com/microsoft/vscode/1.137.0/.nvmrc>
  - <https://raw.githubusercontent.com/microsoft/vscode/1.137.0/.npmrc>
- Locations: `.nvmrc:1`; `.npmrc:1-3`
- Quotes:
  - “24.18.0”
  - `target="42.10.0"`
- Supports: Node 24.18 development/runtime line and Electron 42.10 target for VS Code 1.137.
- Caveat: `.nvmrc` is a build/development pin. Electron supplies the extension-host Node runtime; do not infer every Node patch detail solely from `.nvmrc`.

### [3] Installed VS Code product inspection

- Publisher: Microsoft
- Product inspected: VS Code 1.137.0 for macOS arm64
- Retrieval: local installation, 2026-09-19
- Type: primary local observation
- Locations:
  - `code --version`
  - `/Applications/Visual Studio Code.app/Contents/Resources/app/product.json:1880-1894`
- Quotes:
  - “1.137.0”
  - “645f29cc3176500b4b5762ba887cf2a7f0ffdf2c”
  - `"version": "1.137.0"`
- Supports: the exact stable build available on the research machine.

### [4] Installed Cursor product inspection

- Publisher: Anysphere
- Product inspected: Cursor 3.20.14 for macOS arm64
- Build date: 2026-09-11
- Retrieval: local installation, 2026-09-19
- Type: primary local observation
- Locations:
  - `cursor --version`
  - `/Applications/Cursor.app/Contents/Resources/app/product.json:1-9, 1380-1401`
- Quotes:
  - “3.20.14”
  - `"vscodeVersion": "1.128.0"`
  - `"version": "3.20.14"`
  - `"date": "2026-09-11T21:43:19.302Z"`
- Supports: exact Cursor and declared VS Code Extension API baseline on the research Mac.

### [5] Cursor 3.21.4 version report

- Publisher: Cursor Community Forum; version block supplied by a user, followed by a Cursor staff response
- Published: 2026-09-17
- Type: observed product report, not official release metadata
- URL: <https://forum.cursor.com/t/agent-hangs-on-taking-longer-than-expected-after-3-21-4-update-windows/171933>
- Location: first post, “Version Information”
- Quote: “Version: 3.21.4 (user setup) VS Code Extension API: 1.128.0 ... Electron: 42.10.0 ... Node.js: 24.18.1”
- Supports: later September Cursor build still reports API 1.128.0.
- Confidence: medium. The version block is direct product output, but the source is a user forum post on Windows.

### [6] Cursor’s VS Code rebase policy

- Publisher: Anysphere, Cursor documentation
- Updated: current on 2026-09-19
- Type: official documentation
- URL: <https://cursor.com/docs/configuration/migrations/vscode.md>
- Location: “Version Updates”
- Quote: “We regularly rebase Cursor onto the latest VS Code version to stay current with features and fixes. To ensure stability, Cursor often uses slightly older VS Code versions.”
- Supports: Cursor cannot be assumed to match current VS Code.

### [7] Cursor extension API cadence

- Publisher: Cursor Community Forum; answer by Cursor staff member Mohit
- Published: 2026-06-05
- Type: official staff statement on community forum
- URL: <https://forum.cursor.com/t/how-often-is-the-underlying-vscode-extension-api-updated-in-cursor/162486>
- Location: reply 6
- Quotes:
  - “There’s no fixed schedule or public roadmap for syncing Cursor with newer upstream VS Code releases.”
  - “The declared API compatibility version ... doesn’t always line up one-to-one with the underlying editor internals, which can sit on an older base.”
- Supports: test Cursor behavior directly; the displayed API version is necessary but not sufficient evidence.
- Confidence: medium-high. It is a staff statement, but not versioned product documentation.

### [8] Extension manifest engine contract

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical API documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/api/references/extension-manifest>
- Location: “Fields”, `engines`
- Quote: “An object containing at least the `vscode` key matching the versions of VS Code that the extension is compatible with. Cannot be `*`.”
- Supports: `engines.vscode` must represent the lowest genuinely supported host API.

## Extension host, trust, lifecycle, and configuration

### [9] Extension host topology

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical API documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/api/advanced-topics/extension-host>
- Location: “Extension Host configurations” and “Preferred extension location”
- Quotes:
  - “local – A Node.js extension host running locally”
  - “web – A web extension host running in the browser or locally”
  - “remote – A Node.js extension host running remotely”
  - “`"extensionKind": ["workspace"]` ... requires access to workspace contents and therefore needs to run where the workspace is located.”
- Supports: topology and `extensionKind` selection.

### [10] Remote extension behavior

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical API documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/api/advanced-topics/remote-extensions>
- Location: “Architecture and extension kinds”, opening paragraphs
- Quotes:
  - “Workspace Extensions are run on the same machine as where the workspace is located.”
  - “if your extension uses APIs not provided by VS Code — such using Node APIs or running shell scripts — it may not work properly when run remotely.”
  - “We recommend that you test that all features of your extension work properly in both local and remote workspaces.”
- Supports: a native workspace tool runs remotely in remote workspaces unless the product deliberately rejects that mode.

### [11] Workspace Trust

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current page includes current test guidance; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/extension-guides/workspace-trust>
- Location: “Static declarations”, “Workspace Trust API”, “Commands, views, or other UI”
- Quotes:
  - “Workspace Trust is a feature driven by the security risks associated with unintended code execution when a user opens a workspace in VS Code.”
  - “Use the `isTrusted` property to determine if the current workspace is trusted”
  - “A command can still be called even if it is not presented in the UI, so you should block execution or not register a command”
- Supports: use `limited`, restrict executable-path/argument settings, and enforce trust in handlers.

### [12] Activation and asynchronous cleanup

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical API documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/api/references/activation-events>
- Location: opening notes and “Start up”
- Quotes:
  - “an extension should export a `deactivate()` function ... to perform cleanup tasks on VS Code shutdown.”
  - “Extension must return a Promise from `deactivate()` if the cleanup process is asynchronous.”
  - “an extension can listen to multiple activation events, and that is preferable to listening to `"*"`.”
- Supports: targeted activation and awaited language-client shutdown.

### [13] Configuration scopes

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current contribution reference; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/references/contribution-points#contributes.configuration>
- Location: “scope”, source page lines 501-553 in fetched copy
- Quotes:
  - “`machine` - Machine specific settings ... The value of these settings will not be synchronized.”
  - “`resource` - Resource settings ... can be configured in all settings levels, even folder settings.”
  - “If no `scope` is declared, the default is `window`.”
- Supports: executable path is machine-scoped; project behavior is resource-scoped.

### [14] Multi-root settings

- Publisher: Microsoft, Visual Studio Code documentation
- Updated: undated canonical user/workspace documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces>
- Location: “Settings”
- Quote: “With multiple root folders in one workspace, it is possible to have a `.vscode` folder in each root folder defining the settings that should apply for that folder.”
- Supports: do not collapse all projects onto the first workspace folder.

## LSP and native processes

### [15] Current Language Server Extension Guide

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current guide reflects LanguageClient 10 lifecycle; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/language-extensions/language-server-extension-guide>
- Location: client `activate`/`deactivate` example and sample list
- Quotes:
  - “`await client.start();`”
  - “`await client?.dispose();`”
  - “lsp-multi-server-sample ... starts a different server instance per workspace folder”
- Supports: await startup, dispose on deactivation, and use a per-folder client where server state is project-scoped.

### [16] LanguageClient 10 lifecycle

- Publisher/repository: Microsoft, `microsoft/vscode-languageserver-node`
- Commit: `87f58727b5d287ef9049fb0b4b52984a6e62d604`
- Commit date: 2026-09-18
- Type: primary source
- URLs:
  - <https://github.com/microsoft/vscode-languageserver-node/blob/main/README.md>
  - <https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/client.ts>
- Locations:
  - `README.md`, “3.18.0 Protocol ... 10.0.0 Client”
  - `client/src/common/client.ts:448-476, 1170-1175, 1293-1299, 1584-1598`
- Quotes:
  - “Both methods now return a promise since these methods are async.”
  - “Extensions should now implement a deactivate function ... and correctly return the `stop` promise”
  - “`return new DefaultErrorHandler(this, maxRestartCount ?? 4);`”
  - “The ... server crashed ... times in the last 3 minutes. The server will not be restarted.”
- Supports: LanguageClient 10 async lifecycle and bounded default crash restart.

### [17] vscode-languageclient transports

- Publisher/repository: Microsoft, `microsoft/vscode-languageserver-node`
- Commit: `87f58727b5d287ef9049fb0b4b52984a6e62d604`
- Type: primary source
- Locations:
  - `client/package.json:1-47`
  - `client/src/node/main.ts:27-74, 127-150`
- Quotes:
  - `"version": "10.1.1"`
  - `"vscode-languageserver-protocol": "3.18.3"`
  - “`export enum TransportKind { stdio, ipc, pipe, socket }`”
  - “When omitted, stdout and stderr are forwarded line by line to the client's output channel”
- Supports: current dependency line, stdio availability, and default logging behavior.
- Caveat: `client/package.json` says `engines.vscode: ^1.91.0`, while the current Node client source runtime check is `^1.106.0`. Cursor 1.128 satisfies both, but consumers should test the published package they pin.

### [18] Node 24 child process API

- Publisher: OpenJS Foundation, Node.js
- Version: Node.js v24.20.0 documentation
- Type: official runtime documentation
- URL: <https://nodejs.org/docs/latest-v24.x/api/child_process.html>
- Location: `child_process.spawn()` options
- Quotes:
  - “`signal` allows aborting the child process using an AbortSignal.”
  - “`shell` ... Default: `false` (no shell).”
  - “`killSignal` ... Default: `'SIGTERM'`.”
- Supports: direct spawn with an argument array, no shell, cancellation, and explicit termination policy.

## Build, package, and test

### [19] Bundling extensions

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current guide; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/working-with-extensions/bundling-extension>
- Location: opening, “Using esbuild”, and “Tests”
- Quotes:
  - “Loading 100 small files is much slower than loading one large file. That's why we recommend bundling.”
  - “Exclude the 'vscode' module from the bundle (since it's provided by the VS Code runtime).”
  - “esbuild simply strips off all type declarations without doing any type checks.”
- Supports: bundle the extension host, externalize `vscode`, and keep type-checking separate from the bundler. The page demonstrates esbuild; it does not compare esbuild to rsbuild, Rspack, webpack, or other bundlers.

### [20] Publishing and platform-specific VSIX files

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: includes `vsce` behavior through VS Code 1.99+
- Type: official documentation
- URL: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- Location: “Using .vscodeignore”, “Platform-specific extensions”, “FAQ”
- Quotes:
  - “You should ignore all files not needed at runtime.”
  - “Platform-specific extensions are useful if your extension has platform-specific libraries or dependencies”
  - “You can specify the target platform by passing the `--target` flag.”
  - “Publishing from Linux and macOS works as expected” for preserving POSIX executable bits.
- Supports: inspect packaged contents; use per-platform VSIX only for shipped native artifacts/native modules.

### [21] VS Code extension testing

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current page includes Workspace Trust configurations
- Type: official documentation
- URL: <https://code.visualstudio.com/api/working-with-extensions/testing-extension>
- Location: “Quick Setup: The test CLI” and “Testing Workspace Trust behavior”
- Quotes:
  - “The VS Code team publishes a command-line tool to run extension tests.”
  - “install the `@vscode/test-cli` module, as well as `@vscode/test-electron`”
  - “add integration tests for both trusted and untrusted workspaces.”
- Supports: current extension-host test runner and trust matrix.

### [22] GitHub Actions hardening

- Publisher: GitHub Docs
- Updated: current on 2026-09-19
- Type: official documentation
- URL: <https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions>
- Location: “Using third-party actions”, fetched copy lines 100-116
- Quotes:
  - “Pinning an action to a full-length commit SHA is currently the only way to use an action as an immutable release.”
  - “make sure that the `GITHUB_TOKEN` is granted the minimum required permissions.”
- Supports: full-SHA action pinning and least-privilege workflow permissions.

### [23] Artifact attestations

- Publisher: GitHub Changelog
- Published: 2025-02-18
- Type: official product documentation
- URL: <https://github.blog/changelog/2025-02-18-recent-improvements-to-artifact-attestations/>
- Location: “Attestation verification defaults to build provenance”
- Quote: “Build provenance ... provides a verifiable trail that links the artifact back to its originating workflow run, ensuring its authenticity and integrity.”
- Supports: attesting a released VSIX is a supported, useful hardening step.
- Caveat: no VS Code documentation requires attestations or SBOMs for VSIX publishing.

## Webviews, accessibility, privacy, and secrets

### [24] Webview security and state

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current canonical guide; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/extension-guides/webview>
- Locations: “Controlling access to local resources”, “Security”, “getState and setState”, “Accessibility”
- Quotes:
  - “set `localResourceRoots` to `[]`” to disallow local resources.
  - “Content security policies further restrict the content that can be loaded and executed in webviews.”
  - “you must sanitize all user input.”
  - “`getState` and `setState` are the preferred way to persist state”
  - “`retainContextWhenHidden` ... has high memory overhead”
- Supports: restrictive CSP/roots, trust-boundary validation, state restoration, and avoiding retained hidden contexts.

### [25] Webview UX and accessibility

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical UX guidance
- Type: official documentation
- URL: <https://code.visualstudio.com/api/ux-guidelines/webviews>
- Location: “Do” and “Don’t”
- Quotes:
  - “Only use webviews when absolutely necessary”
  - “Ensure your views follow accessibility guidance (color contrast, ARIA labels, keyboard navigation)”
- Supports: native contributions first and explicit accessibility acceptance criteria.

### [26] Webview UI Toolkit sunset

- Publisher/repository: Microsoft, `microsoft/vscode-webview-ui-toolkit`
- Published: announcement 2024-05-16; scheduled archive date 2025-01-06
- Type: official repository issue
- URL: <https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561>
- Location: issue body and final maintainer comment
- Quotes:
  - “the toolkit NPM package and main repository will be deprecated/archived on ... January 6, 2025”
  - “there are sadly no plans to continue the maintenance of this project.”
- Supports: do not start new work on `@vscode/webview-ui-toolkit`.

### [27] Secret storage

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical API documentation
- Type: official documentation
- URL: <https://code.visualstudio.com/api/extension-capabilities/common-capabilities>
- Location: “Data Storage”
- Quote: “`ExtensionContext.secrets`: A global storage for secrets ... that will be encrypted. These are not synced across machines.”
- Supports: use `SecretStorage`, not settings or mementos, for credentials.

### [28] Telemetry guide

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: undated canonical guidance
- Type: official documentation
- URL: <https://code.visualstudio.com/api/extension-guides/telemetry>
- Location: “Without the telemetry module” and “Do’s and Don’ts”
- Quotes:
  - “it is still required that extension authors respect the user's choice”
  - “Collect as little telemetry as possible.”
  - “Don’t ... Collect Personally identifiable information (PII).”
- Supports: if telemetry exists, honor central controls. For this local-first product, no telemetry is simpler.

### [29] Localization API

- Publisher: Microsoft, Visual Studio Code Extension API
- Updated: current API reference; no page date
- Type: official documentation
- URL: <https://code.visualstudio.com/api/references/vscode-api#l10n>
- Location: `l10n` namespace
- Quote: “To use this properly, you must have `l10n` defined in your extension manifest and have `bundle.l10n.<LANG>.json` files.”
- Supports: use the built-in `vscode.l10n` surface for extension-host strings when localization is in scope.

## Cloned reference repositories

All clones are under `/Users/daniel/references/vscode-extension-development/`, are shallow/filtered where supported, and were retrieved on 2026-09-19. They were not modified.

### [30] `microsoft/vscode-extension-samples`

- URL: <https://github.com/microsoft/vscode-extension-samples>
- HEAD: `65c1c44800eeac6fb065a54823ee5ae62c79540a`
- HEAD date: 2026-09-04
- Selected paths:
  - `esbuild-sample/`: compact extension-host bundling shape
  - `helloworld-test-cli-sample/`: current `.vscode-test.mjs` entry point
  - `webview-sample/`: CSP, nonce, `localResourceRoots`, serialization, and state
  - `lsp-multi-server-sample/client/src/extension.ts`: per-folder client and selector scoping
- Exact evidence:
  - `esbuild-sample/esbuild.js:26-50`
  - `helloworld-test-cli-sample/.vscode-test.mjs:1-5`
  - `webview-sample/src/extension.ts:36-45, 169-220`
  - `lsp-multi-server-sample/client/src/extension.ts:50-129`
- Why selected: official, broad, active in September 2026, and contains directly relevant small examples.
- Caveats:
  - The repository is not uniformly current. Most sample manifests still target VS Code 1.100.
  - `lsp-sample` uses LanguageClient 9.0.1; `lsp-multi-server-sample` uses 7.0.0 and pre-v10 lifecycle style.
  - Use samples for focused patterns, then reconcile them with current API docs and LanguageClient source.

### [31] `microsoft/vscode-languageserver-node`

- URL: <https://github.com/microsoft/vscode-languageserver-node>
- HEAD: `87f58727b5d287ef9049fb0b4b52984a6e62d604`
- HEAD date: 2026-09-18
- Selected paths:
  - `client/src/common/client.ts`: lifecycle, restart policy, selectors, configuration, cancellation
  - `client/src/node/main.ts`: executable server options, transports, stdio logging
  - `client/package.json`: current package/protocol versions
- Why selected: authoritative implementation of `vscode-languageclient`; current one day before the research date.
- Caveats: this is library implementation source, not a model extension architecture. Proposed API declarations in the repository are not permission to use proposed APIs in a Marketplace extension.

### [32] `microsoft/vscode-test-cli`

- URL: <https://github.com/microsoft/vscode-test-cli>
- HEAD: `a72f3178c933206239b2cbaebbae92fe99552087`
- HEAD date: 2026-09-11
- Selected paths:
  - `README.md:1-67`
  - `src/config.cts`
  - `src/cli/platform/desktop.mts`
- Why selected: official current configuration-driven extension test runner.
- Caveats: it runs Mocha internally. It does not provide a Cursor binary adapter or guarantee Cursor compatibility.

### [33] `microsoft/vscode-vsce`

- URL: <https://github.com/microsoft/vscode-vsce>
- HEAD: `c1eebf3b1d0cf90da1aca18e4ab58311bbe39d61`
- HEAD date: 2026-09-15
- Selected paths:
  - `README.md:11-18, 73-97`: Node requirement and OIDC trusted publishing
  - `src/package.ts`, `src/zip.ts`: VSIX composition
  - `src/secretLint.ts`: package secret scanning
- Why selected: authoritative VSIX packaging and publishing implementation, current four days before research.
- Caveats: the repository’s own architecture is not an extension template. Its README’s GitHub workflow uses action tags, while GitHub’s stronger current security guidance recommends full commit SHAs.

## Rejected reference repositories

- `microsoft/vscode-webview-ui-toolkit`: rejected because Microsoft announced its deprecation and scheduled archival for 2025-01-06, then stated that maintenance would not continue [26]. Popularity does not overcome explicit deprecation.
- `microsoft/vscode-eslint`: not selected as a primary template. It is high quality and relevant to LSP, but its mature compatibility surface, migration history, ESLint-specific server model, and remote/web support obscure the minimum architecture for a macOS-first local native process.
- `redhat-developer/vscode-java`: not selected. It is a large Java/JVM product with installer and platform concerns unlike a user-provided `dbt` executable.
- `eamodio/vscode-gitlens`: not selected. It is a large commercial extension with hosted-service and product concerns contrary to this product boundary.
- The whole `microsoft/vscode-extension-samples` repository: rejected as a blanket exemplar. Only the paths in [30] are selected, and even those carry explicit version caveats.

## Evidence gaps

- Cursor publishes no versioned compatibility contract for ordinary VS Code extensions beyond migration/import documentation and its declared product API version.
- No official Cursor extension-host integration test runner or documented headless Cursor test interface was found.
- No authoritative source guarantees Marketplace parity, webview parity, remote parity, or behavior of individual built-in VS Code commands in Cursor.
- No official VS Code source requires an SBOM or attestation for VSIX files. These are optional supply-chain recommendations supported by GitHub, not Marketplace requirements.
- The official VS Code pages generally omit publication/update dates. Current applicability therefore rests on the September 2026 product baseline plus current official repositories, not page timestamps.
