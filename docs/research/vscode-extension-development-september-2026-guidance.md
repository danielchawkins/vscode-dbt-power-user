# Detailed guidance: desktop VS Code and Cursor extensions, September 2026

This guidance is independent of the repository's current implementation. Labels mean:

- **Fact**: directly documented or directly observed.
- **Inference**: conclusion from documented/observed facts.
- **Recommendation**: proposed choice for this product.
- **Gap**: material evidence not found.

Confidence describes the recommendation, not the authority of every underlying source.

## 1. Current baseline and engine strategy

**Fact.** VS Code stable is 1.137.0, released 2026-09-09
[[1]](vscode-extension-development-september-2026-sources.md#1-visual-studio-code-1137). Its tagged source uses
Electron 42.10.0 and the Node 24.18 line
[[2]](vscode-extension-development-september-2026-sources.md#2-vs-code-1137-runtime-pins).

**Fact.** Installed Cursor 3.20.14 declares `vscodeVersion: 1.128.0`
[[4]](vscode-extension-development-september-2026-sources.md#4-installed-cursor-product-inspection). A later September
3.21.4 version report still declares Extension API 1.128.0
[[5]](vscode-extension-development-september-2026-sources.md#5-cursor-3214-version-report).

**Recommendation — high.**

- Set `engines.vscode` to `^1.128.0`.
- Set `@types/vscode` to 1.128.x, not 1.137.x, so compilation catches accidental use of later stable APIs.
- Use no `enabledApiProposals`; proposed APIs are product- and build-specific.
- Use a current TypeScript compiler and Node 24 types only for runtime APIs actually present in both hosts.
- Re-evaluate the floor when Cursor's stable declared API moves, not merely when VS Code releases.

**Why.** The manifest says `engines.vscode` must match compatible versions
[[8]](vscode-extension-development-september-2026-sources.md#8-extension-manifest-engine-contract). The lower host sets
the shared installable surface. Long-tail support does not justify using 1.137-only APIs that make the current Cursor
target ineligible.

**Caveat.** `engines.vscode` does not certify behavior. Cursor staff says declared API compatibility can diverge from
editor internals [[7]](vscode-extension-development-september-2026-sources.md#7-cursor-extension-api-cadence).

## 2. Extension-host topology and native-process boundary

### Running location

**Fact.** Desktop VS Code can run local and web extension hosts; remote windows add a remote Node host
[[9]](vscode-extension-development-september-2026-sources.md#9-extension-host-topology). Workspace extensions run where
the workspace lives [[10]](vscode-extension-development-september-2026-sources.md#10-remote-extension-behavior).

**Recommendation — high.**

- Provide only `main`, not `browser`; a native executable makes this a Node extension.
- Use `extensionKind: ["workspace"]`.
- Declare virtual-workspace support as false or limited because a native local dbt project needs filesystem/process
  semantics that virtual workspaces do not guarantee.
- Decide remote behavior explicitly:
  - **Support remote**: resolve and launch `dbt` in the remote extension host, and test a Dev Container or SSH target.
  - **Local-only**: disable process-backed features when `vscode.env.remoteName` is set and explain the limitation.

**Caveat.** `extensionKind: ["ui"]` would keep execution close to the desktop but loses direct access to remote
workspace files and tools. That is not a compatibility shortcut.

### Workspace Trust

**Recommendation — high.**

- Declare `capabilities.untrustedWorkspaces.supported: "limited"`.
- Put executable path, extra arguments, environment overrides, project hooks, and any config that affects execution in
  `restrictedConfigurations`.
- In Restricted Mode, allow passive syntax/UI that cannot execute workspace content.
- Do not discover, probe, start, or send workspace-derived arguments to `dbt`.
- Hide unavailable actions with `isWorkspaceTrusted`, then enforce `workspace.isTrusted` again in handlers.
- Start sessions from `onDidGrantWorkspaceTrust`; stop or rebuild sessions when relevant configuration changes.

**Evidence.** Workspace Trust exists to address unintended code execution, and hidden commands remain callable
[[11]](vscode-extension-development-september-2026-sources.md#11-workspace-trust).

### Activation, cancellation, disposal, and logging

**Recommendation — high.**

- Activate from contributed commands, views, and the dbt language/project marker needed for the product. Avoid `*` and
  `onStartupFinished` unless measured behavior requires them.
- Keep activation cheap: register UI and project discovery, then start a server only for an eligible trusted project.
- Push all VS Code registrations into `context.subscriptions`.
- Give each project session one cancellation source for startup and long-running operations.
- Propagate provider cancellation tokens into custom LSP requests and process operations.
- Return/await asynchronous shutdown from `deactivate`.
- Use one `LogOutputChannel` per extension or a clearly named channel per project when logs must be separated.
- Prefix records with project identity and lifecycle state; never log environment values wholesale.

**Evidence.** Targeted activation is preferred, and asynchronous cleanup must return a Promise
[[12]](vscode-extension-development-september-2026-sources.md#12-activation-and-asynchronous-cleanup).

### Process execution

**Recommendation — high.**

- Resolve in order: explicit machine-scoped path, then the extension host's inherited `PATH`.
- Use direct process execution with an argument array and `shell: false`.
- Pass only required environment additions over a copy of `process.env`; do not source shell startup files.
- Set `cwd` to the owning project folder.
- Capture stderr to the log channel; reserve stdout for LSP when using stdio.
- Handle spawn errors, early exits, normal shutdown, forced shutdown after a bounded timeout, and cancellation.
- Do not detach a server intended to die with the extension host.
- Redact paths or values only where they contain secrets; do not erase useful local diagnostics by default.

**Evidence.** Node 24 `spawn` supports AbortSignal, defaults to no shell, and uses `SIGTERM` as the default kill signal
[[18]](vscode-extension-development-september-2026-sources.md#18-node-24-child-process-api).

**Product boundary.** Runtime resolution must not invoke mise, asdf, Homebrew, or repository task runners. A user can
arrange `PATH` with any tool manager before launching the editor; the extension only sees the resulting executable
environment.

## 3. Multi-root and configuration

**Recommendation — high.**

- Treat each supported dbt project as a project session, not as global extension state.
- Never use `workspaceFolders[0]` as an implicit project.
- Resolve documents with `workspace.getWorkspaceFolder(uri)` plus the product's explicit project-scoping rule.
- Add/remove sessions on `onDidChangeWorkspaceFolders`; cancel startup and dispose diagnostics/client/process on
  removal.
- Read resource settings with the relevant folder/document URI.
- Keep project-derived caches under `storageUri`; keep cross-workspace state under `globalStorageUri`.

**Setting scopes.**

- dbt executable path: `machine`.
- Optional environment override: preferably omit; if essential, `machine` and trust-restricted.
- Project behavior and project selection: `resource`.
- Window-wide presentation: `window`.
- Language-specific editor behavior: `language-overridable` only when users genuinely need it.

**Evidence.** Machine values are not synchronized, resource settings can be folder-scoped
[[13]](vscode-extension-development-september-2026-sources.md#13-configuration-scopes), and multi-root folders can have
independent `.vscode` settings [[14]](vscode-extension-development-september-2026-sources.md#14-multi-root-settings).

**Checklist.**

- Two folders with separate dbt paths/configurations do not share process state.
- Adding a folder starts only its eligible project sessions.
- Removing a folder clears its diagnostics and leaves no process.
- Nested folders follow one documented ownership rule.
- Untitled and out-of-workspace documents do not reach an arbitrary server.
- A configuration change restarts only affected sessions.

## 4. LSP client/server architecture

### Client shape

**Recommendation — high.**

- Pin `vscode-languageclient` 10.1.x and its lockfile-resolved transitive versions.
- Create one client per project folder when the server's workspace state is project-scoped.
- Set `clientOptions.workspaceFolder`.
- Scope `documentSelector` with language, scheme, and a folder-relative pattern so clients never overlap.
- Name diagnostic collections consistently and clear them on session disposal.
- Register custom request/notification handlers before `start`.
- Await `client.start()`; call `client.dispose()` during final teardown.

**Evidence.** Current official guidance awaits start and disposes on deactivate
[[15]](vscode-extension-development-september-2026-sources.md#15-current-language-server-extension-guide).
LanguageClient 10 changed start/stop to Promises
[16](vscode-extension-development-september-2026-sources.md#16-languageclient-10-lifecycle).

### Transport and supervision

**Recommendation — high.**

- Prefer stdio for an external native dbt Fusion process: no port allocation, no listener exposure, and native
  LanguageClient support.
- Do not parse or log stdout outside the protocol framing.
- Route stderr line-by-line to the client log channel.
- Preserve the default bounded restart policy initially. It restarts up to the configured count and stops after a crash
  loop.
- Add a user-visible restart command and session status.
- Suppress restart after deliberate stop, project removal, trust loss, or configuration-driven replacement.
- Record exit code/signal and restart count.

**Evidence.** Current client 10.1.1 exposes stdio, IPC, pipe, and socket transports and forwards server streams to its
output channel. Its default restart handler is bounded.
[17](vscode-extension-development-september-2026-sources.md#17-vscode-languageclient-transports)
[16](vscode-extension-development-september-2026-sources.md#16-languageclient-10-lifecycle)

**Caveat.** The official `lsp-sample` and multi-server sample lag current LanguageClient lifecycle versions. Use their
selector/session patterns, not their dependency versions or un-awaited starts
[[30]](vscode-extension-development-september-2026-sources.md#30-microsoftvscode-extension-samples).

### Diagnostics, commands, and cancellation

**Recommendation — high.**

- Let the LSP own language diagnostics and capabilities. Avoid duplicate VS Code providers for capabilities already
  served by dbt Fusion.
- Namespace custom methods and commands under the extension identity.
- Define runtime schemas/type guards for custom LSP payloads. TypeScript types are not trust-boundary validation.
- Pass `CancellationToken` to custom requests and stop follow-on work when cancellation wins.
- Reject stale responses by project/session generation after restart.
- Keep server-to-client commands allowlisted; do not execute arbitrary command names or shell text from LSP payloads.

### Server compatibility checks

**Recommendation — medium.**

- On startup, run the minimum version/protocol handshake the server supports.
- Reject an unsupported dbt Fusion version with one actionable message.
- Do not install or update dbt.
- Avoid a separate version probe if the LSP initialize response already carries enough version information.

## 5. Build, module format, and package

### Extension host

**Recommendation — high.**

- Bundle to one Node/CommonJS extension-host entry.
- Externalize `vscode`; it is provided by the host runtime.
- Run `tsc --noEmit` (or equivalent) separately from the bundler.
- Produce development source maps; decide whether production maps are shipped based on local debugging needs.
- Exclude `sourcesContent` from published maps unless supportability justifies source duplication.
- Fail on unresolved dynamic-require warnings.
- Keep the current bundler if it meets this contract under test.

**Evidence.** VS Code recommends bundling and excluding `vscode` from the bundle
[[19]](vscode-extension-development-september-2026-sources.md#19-bundling-extensions). The same page demonstrates
esbuild and notes that esbuild does not type-check. That is a property of the demonstrated tool, not a ranking of
bundlers. This research does not establish that esbuild is required or superior to rsbuild, Rspack, webpack, or another
current bundler.

**Module-format caveat.** VS Code's current bundling guide still demonstrates CommonJS for Node extensions. Native ESM
may work in current hosts, but adds no product value here and increases host/bundler edge cases. CommonJS is the
lower-risk recommendation, not a claim that ESM is unsupported.

### Webviews

- Build each webview as a separate browser bundle.
- Do not import Node modules or extension-host code into the webview.
- Keep message contracts in a small shared, runtime-validated package/module.
- Content-hash assets only if the HTML generator resolves them deterministically.

### Native dependencies and platform targets

**Recommendation — high.**

- While dbt is external, publish one platform-neutral VSIX.
- Do not add native Node modules without a measured need.
- If the VSIX later contains native code or a bundled executable, publish explicit target packages: `darwin-arm64` and
  `darwin-x64` first, then only platforms the product supports.
- Build executable-bearing packages on macOS/Linux and verify mode bits after unpacking.

**Evidence.** Target-specific VSIX files exist for platform-specific dependencies
[[20]](vscode-extension-development-september-2026-sources.md#20-publishing-and-platform-specific-vsix-files).

### VSIX contents and size

**Recommendation — high.**

- Run `vsce ls` before packaging.
- Unzip the built VSIX and assert required entries and forbidden paths.
- Include runtime bundle, webview assets, manifest, README/license, icons, and localization bundles.
- Exclude source, tests, fixtures, coverage, editor config, caches, development maps if not intentionally shipped, and
  all unneeded `node_modules`.
- Report compressed and unpacked sizes in CI; use a regression threshold based on the established artifact, not an
  arbitrary universal number.

### Supply chain

- Commit the npm lockfile and use `npm ci`.
- Prefer exact direct dependency versions for critical runtime packages.
- Review install scripts; avoid dependencies that require them when a native/platform API suffices.
- Keep build tools in `devDependencies`.
- Pin Actions by full SHA and annotate the human-readable release tag in a comment.
- Give build jobs `contents: read`; add only the permissions required for publication/attestation.

## 6. Testing strategy

### Layers

**Unit.**

- Project-selection rules.
- executable resolution input/output.
- settings migration.
- message validation.
- restart state decisions not already owned by LanguageClient.
- URI/path normalization.

**VS Code extension host.**

- Activation and command registration.
- trust gating.
- project session creation/disposal.
- multi-root behavior.
- webview message round trips.
- LSP startup, custom requests, diagnostics, cancellation, crash, restart, and shutdown.

**Release artifact.**

- Package the VSIX.
- Install that exact file into an isolated host profile.
- Open a fixture workspace.
- activate, start the real or controlled test server, receive one diagnostic/request, stop, and assert no surviving
  child.

### Tools and matrix

**Recommendation — high.** Use `@vscode/test-cli` and `@vscode/test-electron`
[[21]](vscode-extension-development-september-2026-sources.md#21-vs-code-extension-testing). Pin the tested VS Code
version to 1.137.x for the release gate; optionally run Insiders as non-blocking early warning.

Minimum release matrix:

- VS Code 1.137 stable, macOS arm64.
- Cursor current stable, macOS arm64.
- trusted and untrusted fixture workspaces.
- one project, multiple root folders, folder removal.
- explicit executable path and `PATH`.
- missing executable, unsupported version, crash loop, and cancellation.

Add macOS x64 when a real x64 runner is available or when packaging native artifacts. Add one remote Linux case only if
remote support is promised.

**Cursor gap.** `@vscode/test-cli` downloads/runs VS Code, not Cursor
[[32]](vscode-extension-development-september-2026-sources.md#32-microsoftvscode-test-cli). No official Cursor adapter
was found. A Cursor smoke harness must therefore be treated as product-owned infrastructure and kept narrow.

### Proposed APIs

- Do not use them in production.
- Do not enable them only for VS Code while silently degrading Cursor unless the product explicitly accepts a two-tier
  feature.
- If experimentation is necessary, isolate it in a non-shipping branch/build.

## 7. Webview guidance

**Recommendation — high.**

- Use a webview only when native VS Code contributions cannot express the interaction
  [[25]](vscode-extension-development-september-2026-sources.md#25-webview-ux-and-accessibility).
- Set `localResourceRoots` to the exact media directories, or `[]`.
- Start CSP with `default-src 'none'`; allow only required `style-src`, `img-src`, and nonce-bearing `script-src`.
- Do not enable command URIs unless a specific allowlisted use case exists.
- Acquire the VS Code API once and keep it private to the webview application.
- Validate both directions as discriminated unions at runtime.
- Treat file contents, paths, settings, and server output as untrusted display data.
- Prefer `textContent` and safe DOM construction over HTML injection.
- Use `getState`/`setState`; add a serializer only for panels that should survive restart.
- Avoid `retainContextWhenHidden` unless profiling shows reconstruction is unacceptable.

**Accessibility acceptance checks.**

- Complete every action by keyboard.
- Visible focus in light, dark, high-contrast dark, and high-contrast light.
- Programmatic names/roles/states for controls.
- Logical heading and tab order.
- Status and errors announced without stealing focus.
- Zoom/reflow at 200%.
- `vscode-using-screen-reader` and `vscode-reduce-motion` respected.
- No color-only state.

**Toolkit choice.** Use semantic HTML and small local styles/components first. Microsoft's Webview UI Toolkit is
archived and unmaintained [[26]](vscode-extension-development-september-2026-sources.md#26-webview-ui-toolkit-sunset).
Community replacements may be evaluated for a concrete need, but neither popularity nor VS Code-like appearance is
enough reason to add one.

## 8. Commands, settings, localization, privacy, and security

### Names and migration

- Choose one durable lowercase extension namespace.
- Keep command IDs stable; change user-facing titles independently.
- Give every setting a default, scope, description, and narrow schema.
- Mark old settings with `deprecationMessage`/`markdownDeprecationMessage`.
- During a bounded migration window, read old values only when the new key is unset; write the new key once if user
  intent is unambiguous.
- Do not silently broaden a setting from user scope to workspace execution authority.

### Contributions and activation

- Let command/view/language contributions provide activation where current VS Code supports it.
- Use `when` for contextual visibility and `enablement` for executable preconditions.
- Enforce security preconditions in handlers, not only contribution metadata.
- Avoid duplicate commands that only alias the same operation unless preserving a documented migration.

### Localization

**Recommendation — medium.**

- Keep all user-visible strings localizable from the first new code.
- Use `%key%` manifest strings and `vscode.l10n.t` for extension-host strings.
- Add translated bundles only when product scope requires them; localizable structure is cheap, speculative
  translations are not.

**Evidence.** `vscode.l10n` uses manifest-declared localization bundles
[[29]](vscode-extension-development-september-2026-sources.md#29-localization-api).

### Telemetry and privacy

**Recommendation — high.** Send no telemetry and call no hosted service. Local logs should be user-opened, bounded, and
free of secrets. Do not add an analytics dependency for “future observability.”

**Caveat.** If the boundary changes, VS Code requires honoring its central telemetry state and minimizing collection
[[28]](vscode-extension-development-september-2026-sources.md#28-telemetry-guide).

### Secrets and URI handling

- This product should need no secret for local dbt Fusion.
- If a future feature introduces one, use `ExtensionContext.secrets`, never settings/globalState/workspaceState
  [[27]](vscode-extension-development-september-2026-sources.md#27-secret-storage).
- Register URI handlers only for a concrete flow.
- Validate authority, path, nonce/state, and every query value.
- Never accept a command line, executable path, or arbitrary command ID from a URI.

### Security review checklist

- Workspace Trust gates process execution and execution-affecting settings.
- Child process uses argument arrays and no shell.
- Webview CSP and runtime message validation exist.
- LSP custom methods are allowlisted and validated.
- Paths are resolved relative to the owning project, with symlink behavior tested.
- Logs omit secrets and do not dump complete environments.
- Dependencies and install scripts are reviewed.
- No proposed API.

## 9. CI and release

**Required gate.**

1. clean install from lockfile;
2. type-check, lint, unit tests;
3. VS Code extension-host matrix;
4. production bundles;
5. package VSIX;
6. list and inspect contents;
7. smoke-install exact VSIX;
8. compute SHA-256;
9. retain artifact and test results.

**Action security.** Pin every action to a full commit SHA and use least-privilege token permissions
[[22]](vscode-extension-development-september-2026-sources.md#22-github-actions-hardening).

**Publication.** Prefer short-lived OIDC/trusted publishing where the target supports it. The current `vsce` repository
documents OIDC publishing [[33]](vscode-extension-development-september-2026-sources.md#33-microsoftvscode-vsce). Keep
packaging and publishing as separate jobs so only a verified artifact gains release credentials.

**Attestations and SBOM.**

- Attest the final VSIX when GitHub artifact attestations are available; provenance links it to the source workflow
  [[23]](vscode-extension-development-september-2026-sources.md#23-artifact-attestations).
- Generate an SBOM only if consumers, policy, or incident response will use it. No authoritative VS Code source makes
  one a packaging requirement.
- Publish SHA-256 checksums regardless; they are simple and useful for private distribution.

## 10. Cursor compatibility: test contract

### Explicitly documented

- Cursor is VS Code-based and can import extensions.
- Cursor may use an older VS Code base
  [[6]](vscode-extension-development-september-2026-sources.md#6-cursors-vs-code-rebase-policy).
- The current observed stable API target is 1.128
  [[4]](vscode-extension-development-september-2026-sources.md#4-installed-cursor-product-inspection).

### Test rather than assume

- installation from the produced VSIX;
- activation events and command enablement;
- Workspace Trust transitions;
- stable built-in commands used by the extension;
- LSP diagnostics, progress, cancellation, and restart;
- webview CSP, resource URIs, state restoration, theme, and accessibility classes;
- multi-root folder events and scoped configuration;
- local/remote extension placement;
- output channels and log visibility;
- extension update behavior in Cursor's gallery/private distribution path.

### Avoid

- Cursor-only APIs unless the feature is explicitly Cursor-only and guarded by host detection.
- branding or command behavior that shadows Cursor's own AI surfaces.
- assuming Cursor's declared API version proves a specific upstream bug fix.
- using current VS Code-only APIs and lowering `engines.vscode` to force installation.

## 11. Reference repositories

### Selected

1. `microsoft/vscode-extension-samples` at `65c1c44800eeac6fb065a54823ee5ae62c79540a`
   [[30]](vscode-extension-development-september-2026-sources.md#30-microsoftvscode-extension-samples)
   - use only `esbuild-sample`, `helloworld-test-cli-sample`, `webview-sample`, and the multi-server selector/session
     pattern;
   - do not copy their old engine or LanguageClient versions.
2. `microsoft/vscode-languageserver-node` at `87f58727b5d287ef9049fb0b4b52984a6e62d604`
   [[31]](vscode-extension-development-september-2026-sources.md#31-microsoftvscode-languageserver-node)
   - primary source for LanguageClient 10 lifecycle, restart, transports, and per-folder options.
3. `microsoft/vscode-test-cli` at `a72f3178c933206239b2cbaebbae92fe99552087`
   [[32]](vscode-extension-development-september-2026-sources.md#32-microsoftvscode-test-cli)
   - current VS Code extension-host test configuration and runner.
4. `microsoft/vscode-vsce` at `c1eebf3b1d0cf90da1aca18e4ab58311bbe39d61`
   [[33]](vscode-extension-development-september-2026-sources.md#33-microsoftvscode-vsce)
   - packaging/publishing behavior, not an extension architecture template.

### Rejected as primary references

- `microsoft/vscode-webview-ui-toolkit`: archived and unmaintained.
- `microsoft/vscode-eslint`: mature, high-quality, but carries broad compatibility and ESLint-specific complexity.
- `redhat-developer/vscode-java`: JVM/install/product architecture is not analogous.
- `eamodio/vscode-gitlens`: hosted/commercial surface conflicts with the local-only boundary.
- the entire official samples repository: individual samples vary in age and dependency level.

Popularity was not used as evidence. Selection favored authority, September 2026 maintenance, narrow relevance, and
inspectable current implementation.

## 12. Implementation readiness checklist

Before product code:

- [ ] Confirm Cursor's current declared API on each release image used for testing.
- [ ] Decide remote behavior in one sentence.
- [ ] Confirm dbt Fusion's LSP transport and graceful-shutdown behavior.
- [ ] Define project ownership in nested and multi-root workspaces.
- [ ] Define the extension namespace and setting scopes.

Before first VSIX:

- [ ] Stable API only; `engines.vscode` and `@types/vscode` aligned to 1.128.
- [ ] Trust-gated direct process spawn.
- [ ] Per-project client/session lifecycle with cancellation.
- [ ] Production extension and webview bundles.
- [ ] CSP, runtime message validation, and accessibility checks.
- [ ] VS Code and Cursor smoke tests install the exact VSIX.
- [ ] Contents, size, mode bits, and SHA-256 verified.

Before release:

- [ ] Full-SHA Actions and least-privilege permissions.
- [ ] Trusted/untrusted and multi-root release tests green.
- [ ] No orphan process after shutdown.
- [ ] No secrets, telemetry, hosted calls, proposed APIs, or runtime tool-manager assumptions.
- [ ] Known Cursor gaps recorded against the tested Cursor version and commit.
