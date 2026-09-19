# Desktop VS Code extension development, September 2026

## Executive summary

**Documented fact.** VS Code 1.137, released 2026-09-09, is the current stable baseline.[^1] The installed macOS build
is 1.137.0, and the tagged source pins Electron 42.10.0 and Node 24.18.0 for development.[^2]

**Documented fact plus direct observation.** Cursor explicitly says it “often uses slightly older VS Code versions.”[^3]
The installed Cursor 3.20.14 declares VS Code Extension API 1.128.0; a 2026-09-16 Cursor 3.21.4 version report also
declares 1.128.0.[^4] Cursor staff says the declared API version need not match editor internals one-to-one.[^5]

**Recommendation — high confidence.** Set `engines.vscode` to `^1.128.0`, compile against the 1.128 stable API, and do
not use proposed APIs. This is the highest current minimum that admits both hosts. Raise it only when a required,
tested API is unavailable in Cursor. Test the same packaged VSIX in VS Code 1.137 and current Cursor; an engine range
is an installation gate, not behavioral proof.

**Recommendation — high confidence.** Make the extension a Node workspace extension. A native local executable cannot
run in a browser worker, and workspace extensions run where the workspace is located.[^6] Declare remote and
virtual-workspace behavior instead of allowing accidental placement. For a macOS-first local product, either:

- support remote workspaces by resolving and launching `dbt` on the remote workspace host; or
- declare the limitation and keep native-process features disabled there.

Do not force a UI extension merely to keep the process on the user's Mac; that would separate it from remote workspace
files.

**Recommendation — high confidence.** Use one project session and one LanguageClient per dbt project/workspace folder.
Scope each `documentSelector` to that folder. Use `vscode-languageclient` 10.1.x and stdio for the native server unless
the server requires another transport. Await `start()`, dispose the client during deactivation, preserve the library's
bounded crash restart, and expose restart/status commands plus a log output channel.[^7]

**Recommendation — high confidence.** Gate every process launch behind Workspace Trust. Declare
`untrustedWorkspaces: { supported: "limited", ... }`, restrict executable/argument settings, hide unavailable UI, and
enforce the check again in command handlers; hidden commands remain callable.[^8] Resolve the executable from a
machine-scoped explicit path or the extension host's `PATH`. Never invoke a tool manager at runtime.

**Recommendation — high confidence.** Meet this output contract: one Node/CommonJS extension-host bundle, externalized
`vscode`, a separate type check (`tsc --noEmit`), and separately bundled webviews.[^9] The official bundling guide
demonstrates esbuild and notes it does not type-check; it does not prove esbuild is required or better than rsbuild,
Rspack, or another current bundler. Keep an existing bundler if it satisfies and tests this contract. Ship one
platform-neutral VSIX while the extension only locates an external `dbt`; use `darwin-arm64`/`darwin-x64` VSIX files
only if native artifacts enter the package.[^10] Inspect `vsce ls` and the unpacked VSIX in CI.

**Recommendation — high confidence.** Use `@vscode/test-cli` plus `@vscode/test-electron` for extension-host tests,
with separate trusted and untrusted runs.[^11] Add focused fixtures for no-folder, one folder, multi-root add/remove,
server crash/restart, cancellation, malformed server/webview messages, missing executable, and paths containing spaces.
Unit-test host-independent logic without VS Code.

**Recommendation — medium confidence.** Test Cursor by installing the built VSIX into a clean Cursor profile and
running a small compatibility smoke suite. No official Cursor test runner or compatibility contract was found, so
Cursor automation may require a maintained local harness. Treat manual testing as a temporary gap, not proof.

**Recommendation — high confidence.** Use native VS Code UI wherever it can express the feature. For necessary
webviews, set narrow `localResourceRoots`, a nonce-based CSP with `default-src 'none'`, validate every incoming message
at runtime, sanitize workspace-derived output, and persist with `getState`/`setState` rather than
`retainContextWhenHidden`.[^12] Test keyboard-only operation, screen readers, reduced motion, and all contrast themes.
Do not adopt Microsoft's archived Webview UI Toolkit.[^13]

**Recommendation — high confidence.** Keep commands and settings under one durable namespace. Make the dbt path
`machine` scoped and project behavior `resource` scoped.[^14] Deprecate old settings in place before removing them. Use
`SecretStorage` only if secrets are introduced; it is encrypted and not synchronized.[^15] Keep the product's
no-telemetry boundary: it is simpler and stricter than implementing VS Code's telemetry consent rules.

**Recommendation — high confidence.** Pin npm inputs with a committed lockfile, pin GitHub Actions by full commit SHA,
grant minimum workflow permissions, build the VSIX on macOS so executable bits are preserved, record a SHA-256 digest,
and smoke-install the exact release artifact.[^16] Provenance attestation is a useful optional control; neither SBOMs
nor attestations are documented Marketplace requirements.[^17]

## Cursor: known, inferred, unknown

### Known

- Cursor is VS Code-based, imports VS Code extensions, and intentionally may lag VS Code.[^3]
- Cursor 3.20.14 on the research Mac declares Extension API 1.128.0.[^4]
- Cursor has its own extension gallery and product overrides. This is direct product-file observation, not an official
  compatibility promise.[^4]

### Inferred

- A stable API extension targeting 1.128 or lower is likely installable in both products. This follows from the
  manifest engine contract and observed host versions, but does not prove behavior.[^18]
- Node 24-compatible extension-host code is likely safe across the two September builds because both observed runtimes
  are on Node 24. This should guide syntax/runtime choices, not replace host tests.[^2][^4]
- Standard language, command, configuration, webview, and workspace APIs are the lowest-risk compatibility surface.
  This is a recommendation based on Cursor's VS Code base, not an explicit Cursor guarantee.

### Unknown

- Exact semantic parity for stable APIs and built-in commands.
- Whether Cursor's webview, remote, Workspace Trust, profile, and extension-management behavior matches VS Code in
  every relevant path.
- A supported headless Cursor extension-test interface.
- Cursor's future rebase cadence; staff says there is no fixed public schedule.[^5]
- Whether one Marketplace publication is always sufficient for Cursor's gallery and enterprise policies.

## Prioritized implications for this product

1. Anchor the public API surface at VS Code 1.128 and verify both hosts before using anything newer.
2. Put project identity, client ownership, diagnostics, cancellation, and teardown behind one project-session seam.
3. Resolve `dbt` directly from an explicit machine setting or `PATH`; trust-gate before discovery or execution.
4. Make multi-root correct from the first implementation: project-scoped sessions, selectors, settings, logs, and
   restart state.
5. Keep the VSIX platform-neutral until it actually contains native code; macOS-first testing does not require a
   macOS-only package.
6. Treat webviews as untrusted message boundaries and make accessibility part of their acceptance tests.
7. Add a release-artifact test: package, list contents, install the VSIX, activate it, start a real process, and verify
   shutdown leaves no child.

## Five highest-value decisions

1. `engines.vscode: ^1.128.0`; stable API only.
2. Workspace extension with one LanguageClient/project session per project folder.
3. Explicit path or `PATH` resolution, no runtime tool-manager coupling, and Workspace Trust before execution.
4. Bundled platform-neutral VSIX, adding target-specific packages only for packaged native artifacts.
5. One release smoke matrix: VS Code 1.137, current Cursor, trusted/untrusted, single-root/multi-root, arm64/x64 where
   available.

## Five highest-risk unknowns

1. Cursor stable API behavior may diverge from its declared 1.128 compatibility level.
2. Cursor has no documented extension-host integration test runner.
3. Remote-workspace product semantics are unresolved: run dbt remotely or explicitly decline support.
4. Real dbt Fusion LSP shutdown, crash, and multi-project behavior must be measured against LanguageClient 10.
5. Cursor gallery/enterprise installation behavior for a privately distributed VSIX lacks a versioned contract.

## Footnotes

[^1]: [Evidence 1](vscode-extension-development-september-2026-sources.md#1-visual-studio-code-1137): “Release date:
    September 9, 2026”.

[^2]: [Evidence 2](vscode-extension-development-september-2026-sources.md#2-vs-code-1137-runtime-pins): `.nvmrc` says
    “24.18.0”; `.npmrc` says `target="42.10.0"`.

[^3]: [Evidence 6](vscode-extension-development-september-2026-sources.md#6-cursors-vs-code-rebase-policy): “Cursor
    often uses slightly older VS Code versions.”

[^4]: [Evidence 4](vscode-extension-development-september-2026-sources.md#4-installed-cursor-product-inspection) and
    [evidence 5](vscode-extension-development-september-2026-sources.md#5-cursor-3214-version-report):
    `"vscodeVersion": "1.128.0"` and “VS Code Extension API: 1.128.0”.

[^5]: [Evidence 7](vscode-extension-development-september-2026-sources.md#7-cursor-extension-api-cadence): “doesn’t
    always line up one-to-one with the underlying editor internals”.

[^6]: [Evidence 9](vscode-extension-development-september-2026-sources.md#9-extension-host-topology) and
    [evidence 10](vscode-extension-development-september-2026-sources.md#10-remote-extension-behavior): “Workspace
    Extensions are run on the same machine as where the workspace is located.”

[^7]: [Evidence 15](vscode-extension-development-september-2026-sources.md#15-current-language-server-extension-guide)
    and evidence 16: “`await client.start();`” and “Both methods now return a promise”.
    [16](vscode-extension-development-september-2026-sources.md#16-languageclient-10-lifecycle)

[^8]: [Evidence 11](vscode-extension-development-september-2026-sources.md#11-workspace-trust): “A command can still be
    called even if it is not presented in the UI”.

[^9]: [Evidence 19](vscode-extension-development-september-2026-sources.md#19-bundling-extensions): “That's why we
    recommend bundling.” and “Exclude the 'vscode' module from the bundle (since it's provided by the VS Code
    runtime).” The same page demonstrates esbuild and says “esbuild simply strips off all type declarations without
    doing any type checks.”

[^10]: Evidence 20: “Platform-specific extensions are useful if your extension has platform-specific libraries or
    dependencies”.
    [20](vscode-extension-development-september-2026-sources.md#20-publishing-and-platform-specific-vsix-files)

[^11]: [Evidence 21](vscode-extension-development-september-2026-sources.md#21-vs-code-extension-testing): “add
    integration tests for both trusted and untrusted workspaces.”

[^12]: [Evidence 24](vscode-extension-development-september-2026-sources.md#24-webview-security-and-state): “`getState`
    and `setState` are the preferred way to persist state”.

[^13]: [Evidence 26](vscode-extension-development-september-2026-sources.md#26-webview-ui-toolkit-sunset): “there are
    sadly no plans to continue the maintenance of this project.”

[^14]: [Evidence 13](vscode-extension-development-september-2026-sources.md#13-configuration-scopes): machine values
    “will not be synchronized”; resource settings can be set at folder level.

[^15]: [Evidence 27](vscode-extension-development-september-2026-sources.md#27-secret-storage): SecretStorage “will be
    encrypted” and is “not synced across machines.”

[^16]: [Evidence 22](vscode-extension-development-september-2026-sources.md#22-github-actions-hardening): “Pinning an
    action to a full-length commit SHA is ... the only way to use an action as an immutable release.”

[^17]: [Evidence 23](vscode-extension-development-september-2026-sources.md#23-artifact-attestations): provenance
    “links the artifact back to its originating workflow run”.

[^18]: [Evidence 8](vscode-extension-development-september-2026-sources.md#8-extension-manifest-engine-contract):
    `engines.vscode` matches “the versions of VS Code that the extension is compatible with.”
