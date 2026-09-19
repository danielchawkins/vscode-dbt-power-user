# Desktop VS Code extension development, September 2026

## Executive summary

Fusion Power User is a desktop, Node-based extension that launches a user-installed dbt Fusion process and delegates editor intelligence to its language server. The compatibility target therefore has two parts: the current VS Code platform and Cursor's older VS Code Extension API surface.

As of 2026-09-19, VS Code stable is 1.137, and its tagged source pins Node 24 for development.[^1][^2] Cursor documents that it may lag VS Code, while the installed Cursor 3.20.14 and a later September 3.21.4 report both declare Extension API 1.128.[^3][^4] The available version metadata places both products on Node 24, but their patch versions differ and future rebases can change either runtime; the shared extension API and observed host behavior remain the compatibility constraints. Cursor staff also cautions that the declared API version does not map perfectly to the underlying editor.[^5]

The practical baseline is consequently VS Code API 1.128, not the newest API available in VS Code 1.137. That floor should allow installation in both current hosts, but it is not a behavioral compatibility guarantee. The same packaged VSIX still needs to be exercised in both products.

### Recommended platform baseline

- **API surface:** set `engines.vscode` to `^1.128.0`, compile against the 1.128 stable API, and avoid proposed APIs. Raise the floor only when a required feature has been verified in Cursor as well as VS Code.
- **Extension placement:** ship a Node workspace extension. It must run where the workspace and dbt executable live; a browser extension host cannot launch the native process.[^6] Remote workspaces need an explicit policy rather than accidental behavior.
- **Project lifecycle:** own one project session and one `LanguageClient` per declared dbt project. Scope document selectors to the owning folder, await startup, dispose clients during shutdown, retain bounded crash recovery, and expose useful status, restart, and logs.[^7]
- **Process security:** do not discover or launch dbt until the workspace is trusted. Treat executable paths and arguments as restricted configuration, enforce trust inside command handlers, and resolve dbt only from an explicit machine-scoped path or the extension host's `PATH`.[^8]
- **Build and package:** keep one Node/CommonJS extension-host bundle, externalize `vscode`, type-check separately, and bundle webviews independently.[^9] The existing bundler is acceptable if it satisfies that contract. Keep the VSIX platform-neutral while dbt remains external; introduce target-specific packages only if native artifacts enter the VSIX.[^10]
- **Testing:** use `@vscode/test-cli` and `@vscode/test-electron` for VS Code extension-host coverage, including trusted and untrusted workspaces.[^11] Add a narrow Cursor smoke harness that installs and exercises the same VSIX; no official Cursor equivalent to the VS Code test runner was found.
- **Webviews:** prefer native editor UI. Where a webview is necessary, restrict local resources, use a nonce-based CSP, validate messages at runtime, sanitize displayed workspace data, persist with `getState`/`setState`, and include accessibility in acceptance tests.[^12] Do not start new work on Microsoft's archived Webview UI Toolkit.[^13]
- **Configuration and privacy:** keep one durable command and setting namespace, use `machine` scope for the dbt path and `resource` scope for project behavior, migrate old settings deliberately, and retain the no-telemetry/no-hosted-service boundary.[^14] Use `SecretStorage` only if a future feature genuinely introduces secrets.[^15]
- **Release integrity:** install from committed lockfiles, pin Actions by full commit SHA, minimize workflow permissions, inspect the VSIX contents, smoke-install the exact artifact, and publish its SHA-256 digest.[^16]

### Implications for the refactor

The project-session seam is the central architectural move. It should own project identity, client startup and teardown, diagnostics, cancellation, restart state, scoped settings, and logs. Building multi-root behavior into that seam from the start avoids recreating global assumptions when a second project is opened.

Process execution should remain independent of contributor tooling. The extension may inherit a `PATH` prepared by mise, asdf, Homebrew, or a shell, but it should never invoke those tools or read this repository's configuration. Workspace Trust must be checked before version probing as well as before language-server startup.

Release testing should cross the package boundary: build the VSIX, inspect its contents, install that exact file into isolated VS Code and Cursor profiles, activate against representative single-root and multi-root fixtures, start a real or controlled server, and verify that shutdown leaves no child process. Unit tests remain useful for project selection, path resolution, configuration migration, and message validation, but they cannot establish host compatibility.

### Cursor compatibility limits

The evidence for VS Code behavior is strong because it comes from current official documentation, tagged source, and maintained Microsoft repositories. The Cursor position is less certain. Official documentation establishes that Cursor is VS Code-based and may use an older base; local product inspection establishes the declared 1.128 API; neither source promises semantic parity for every stable API.[^3][^4][^5]

The 1.128 target is therefore a conservative shared installation surface, not a claim that the hosts behave identically. Standard language, command, configuration, workspace, and webview APIs are the lowest-risk choices, but none is zero-risk without Cursor testing; smoke tests must cover every capability this extension depends on.

The remaining material unknowns are:

- whether Cursor matches VS Code for Workspace Trust transitions, remote extension placement, webview behavior, profiles, and built-in commands;
- how to automate Cursor extension-host tests without a supported headless test interface;
- whether remote workspaces should run dbt on the remote host or be explicitly unsupported;
- how the real dbt Fusion language server behaves during shutdown, crash recovery, cancellation, and concurrent project startup; and
- how private VSIX distribution interacts with Cursor's gallery and enterprise policies.

### Immediate next steps

1. Align `engines.vscode` and `@types/vscode` on stable API 1.128 before adding the language client.[^17]
2. Decide whether remote workspaces run dbt remotely or disable process-backed features; that decision fixes extension placement and test scope.
3. Introduce the project-session seam before migrating providers so lifecycle and multi-root ownership have one implementation.
4. Add trusted and untrusted VS Code extension-host fixtures, then a narrow Cursor smoke harness that installs the same VSIX.
5. Extend CI to inspect and smoke-install the packaged artifact before changing distribution or adding native dependencies.

## Footnotes

[^1]: [Evidence 1](vscode-extension-development-september-2026-sources.md#1-visual-studio-code-1137): “Release date: September 9, 2026”.

[^2]: [Evidence 2](vscode-extension-development-september-2026-sources.md#2-vs-code-1137-runtime-pins): `.nvmrc` says “24.18.0”; `.npmrc` says `target="42.10.0"`.

[^3]: [Evidence 6](vscode-extension-development-september-2026-sources.md#6-cursors-vs-code-rebase-policy): “Cursor often uses slightly older VS Code versions.”

[^4]: [Evidence 4](vscode-extension-development-september-2026-sources.md#4-installed-cursor-product-inspection) and [evidence 5](vscode-extension-development-september-2026-sources.md#5-cursor-3214-version-report): `"vscodeVersion": "1.128.0"` and “VS Code Extension API: 1.128.0”.

[^5]: [Evidence 7](vscode-extension-development-september-2026-sources.md#7-cursor-extension-api-cadence): “doesn’t always line up one-to-one with the underlying editor internals”.

[^6]: [Evidence 9](vscode-extension-development-september-2026-sources.md#9-extension-host-topology) and [evidence 10](vscode-extension-development-september-2026-sources.md#10-remote-extension-behavior): “Workspace Extensions are run on the same machine as where the workspace is located.”

[^7]: [Evidence 15](vscode-extension-development-september-2026-sources.md#15-current-language-server-extension-guide) and [evidence 16](vscode-extension-development-september-2026-sources.md#16-languageclient-10-lifecycle): “`await client.start();`” and “Both methods now return a promise”.

[^8]: [Evidence 11](vscode-extension-development-september-2026-sources.md#11-workspace-trust): “A command can still be called even if it is not presented in the UI”.

[^9]: [Evidence 19](vscode-extension-development-september-2026-sources.md#19-bundling-extensions): “That's why we recommend bundling.” and “Exclude the 'vscode' module from the bundle (since it's provided by the VS Code runtime).” The same page demonstrates esbuild and says “esbuild simply strips off all type declarations without doing any type checks.”

[^10]: [Evidence 20](vscode-extension-development-september-2026-sources.md#20-publishing-and-platform-specific-vsix-files): “Platform-specific extensions are useful if your extension has platform-specific libraries or dependencies”.

[^11]: [Evidence 21](vscode-extension-development-september-2026-sources.md#21-vs-code-extension-testing): “add integration tests for both trusted and untrusted workspaces.”

[^12]: [Evidence 24](vscode-extension-development-september-2026-sources.md#24-webview-security-and-state): “`getState` and `setState` are the preferred way to persist state”.

[^13]: [Evidence 26](vscode-extension-development-september-2026-sources.md#26-webview-ui-toolkit-sunset): “there are sadly no plans to continue the maintenance of this project.”

[^14]: [Evidence 13](vscode-extension-development-september-2026-sources.md#13-configuration-scopes): machine values “will not be synchronized”; resource settings can be set at folder level.

[^15]: [Evidence 27](vscode-extension-development-september-2026-sources.md#27-secret-storage): SecretStorage “will be encrypted” and is “not synced across machines.”

[^16]: [Evidence 22](vscode-extension-development-september-2026-sources.md#22-github-actions-hardening): “Pinning an action to a full-length commit SHA is ... the only way to use an action as an immutable release.”

[^17]: [Evidence 8](vscode-extension-development-september-2026-sources.md#8-extension-manifest-engine-contract): `engines.vscode` matches “the versions of VS Code that the extension is compatible with.”
