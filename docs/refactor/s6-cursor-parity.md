# S6: Cursor parity

Captured 2026-09-21 on macOS arm64. This spike discharges the three S6 questions for step 5.2: whether `vscode-languageclient@10.1.1` loads in Cursor's extension host, whether this repository's `engines.vscode: ^1.128.0` is satisfiable there, and whether `cursor --install-extension` accepts a local VSIX path. No repository manifest was changed. Temporary harness files lived under `/tmp/s6-cursor-parity`, `$TMPDIR/s6-user-data-*`, `$TMPDIR/s6-extensions-*`, and `$TMPDIR/s6-workspace-*`; all were deleted after recording.

There is no pure headless Cursor extension host on macOS: `@vscode/test-electron` launches a real Electron window. The final activation proof opened one test window and exited when the import assertion completed.

## Host versions

| Host                | App version | Embedded VS Code API            | Application/build commit (short) |
| ------------------- | ----------- | ------------------------------- | -------------------------------- |
| Cursor              | 3.20.14     | 1.128.0                         | 67ac8ff8cc11                     |
| VS Code (reference) | 1.137.0     | not published in `product.json` | 645f29cc3176                     |

Both CLIs were on `PATH`. The embedded API version came from Cursor's bundled `product.json` `vscodeVersion` field.

## Candidate dependency

| Package                 | Version | `engines.vscode` |
| ----------------------- | ------- | ---------------- |
| `vscode-languageclient` | 10.1.1  | `^1.91.0`        |

No `peerDependencies` field is declared on npm for 10.1.1. Its engine floor is below both Cursor's embedded API (1.128.0) and this repository's floor (`^1.128.0`).

## Harness

Two proofs, kept separate:

1. **Local VSIX install** — `cursor --install-extension <path>` with isolated `--user-data-dir` and `--extensions-dir`. No extension-host activation claim from this step.
2. **Extension-host import** — `@vscode/test-cli` 0.0.12 (temporary under `/tmp`, not a repository dependency) driving `@vscode/test-electron` 3.1.0. Only `@vscode/test-electron` 3.1.0 matches this repository's `^3.1.0` devDependency. Config: `.vscode-test.mjs` with `useInstallation.fromPath` set to `/Applications/Cursor.app/Contents/MacOS/Cursor`, `extensionDevelopmentPath` pointing at the temporary smoke extension, and one test under `smoke-test/`.

The smoke extension declares `activationEvents: []`. The test calls `vscode.extensions.getExtension('test.s6-languageclient-smoke').activate()` explicitly. The host log recorded activation event `api`, matching that call. The test also resolves `vscode-languageclient` inside the extension host via `createRequire` rooted at the development extension's `package.json`, then asserts `LanguageClient` is a function.

Clutter-suppression, isolation, and `--disable-extensions` on the final activation launch:

- `--user-data-dir=<temp under $TMPDIR>`
- `--extensions-dir=<temp under $TMPDIR>`
- temporary empty workspace folder as the first launch arg
- `--disable-extensions` (disables non-development extensions; the development extension under `extensionDevelopmentPath` remains loadable)
- `--disable-gpu`
- `--disable-workspace-trust`
- `--skip-welcome`
- `--skip-release-notes`
- `--no-sandbox`
- `--suppress-popups-on-startup`
- `--skip-onboarding`

Before launch the harness removed any prior marker file and set run token `s6-20260922T055501Z-54909` in the test environment. The marker written during the passing run carries the same token.

## Results

### 1. Does `vscode-languageclient@10.1.1` load in Cursor's extension host?

**Yes — via `extensionDevelopmentPath`, not via installed VSIX activation.**

With `--disable-extensions`, `@vscode/test-cli` reported `1 passing (441ms)` and exit status **0**. The host log recorded `Loading development extension at /private/tmp/s6-cursor-parity/smoke-ext` and mapped it to `test.s6-languageclient-smoke`. For the import proof, the relevant activation was:

```text
ExtensionService#_doActivateExtension test.s6-languageclient-smoke, startup: false, activationEvent: 'api'
Extension activated success: test.s6-languageclient-smoke — 0ms
```

Direct host assertions from the passing run:

- `createRequire(.../smoke-ext/package.json)('vscode-languageclient').LanguageClient` is a function
- `vscode.version === '1.128.0'`
- `vscode.env.appName === 'Cursor'`
- `vscode.env.appHost === 'desktop'`
- `vscode.env.uriScheme === 'cursor'`

Marker payload (run token matches this launch):

```json
{
  "ok": true,
  "proof": "extensionDevelopmentPath via @vscode/test-cli and @vscode/test-electron",
  "activation": "explicit extensions.getExtension(...).activate()",
  "hasLanguageClient": true,
  "hostIdentity": {
    "runToken": "s6-20260922T055501Z-54909",
    "vscodeVersion": "1.128.0",
    "appName": "Cursor",
    "appHost": "desktop",
    "uriScheme": "cursor"
  },
  "at": "2026-09-22T05:55:05.192Z"
}
```

`--disable-extensions` did not leave Cursor with only the development extension: built-in Cursor and VS Code extensions (`anysphere.*`, `vscode.*`) still activated in the same host log. The import proof nonetheless ran in Cursor's extension host with the development extension present and explicitly activated; no separately installed marketplace extension participated.

This run does not prove that an installed VSIX auto-activates on window open.

### 2. Is `engines.vscode: ^1.128.0` satisfiable by the installed Cursor host?

**Yes.** Cursor 3.20.14 reports embedded VS Code API **1.128.0**, which satisfies `^1.128.0` at the floor. The test host reported `vscode.version === '1.128.0'`. The smoke extension and VSIX both declared `engines.vscode: ^1.128.0`. Install and the test launch emitted no engine-compatibility rejection.

### 3. Does `cursor --install-extension` accept a local VSIX path?

**Yes — install only; no host activation claim.**

```sh
cursor --install-extension /tmp/s6-cursor-parity/smoke-ext/s6-languageclient-smoke-0.0.1.vsix \
  --extensions-dir <temp> \
  --user-data-dir <temp> \
  --force
```

Exit status **0**. Stdout: `Extension 's6-languageclient-smoke-0.0.1.vsix' was successfully installed.` `cursor --list-extensions --show-versions` then listed `test.s6-languageclient-smoke@0.0.1`. Cursor duplicated `--user-data-dir` / `--extensions-dir` when the CLI wrapper forwarded them and warned it kept the explicit temp values; isolation still held. Deleting the temp extensions directory afterward does not invalidate this install proof.

## Limitations

- macOS Electron requires one visible window; clutter was reduced with the flags above, not eliminated.
- `@vscode/test-cli` `files` must be a glob relative to the config file, not an absolute path containing `**`.
- Extension tests use `suite` / `test`, not bare Mocha `describe` / `it`.
- `require('vscode-languageclient')` from the test file needs a `createRequire` root at the development extension; bare resolution from the test path alone fails.
- `--disable-extensions` suppresses separately installed extensions but not Cursor's bundled built-ins; do not read it as an empty host.
- `@types/vscode` 1.125 versus engine 1.128 is out of scope for this docs-only spike; Phase 5 handles manifest alignment.
- Cursor Helper processes tied to the temp `--user-data-dir` could linger briefly after exit; they were terminated with `pkill -f user-data-dir=<temp>` before cleanup.

## Cleanup

After recording, the harness removed:

- `/tmp/s6-cursor-parity` (source, VSIX builder output, `.vscode-test.mjs`, temporary `node_modules`, marker, logs)
- every `$TMPDIR/s6-user-data-*`, `$TMPDIR/s6-extensions-*`, and `$TMPDIR/s6-workspace-*` directory from all attempts
- matching `/tmp/s6-*` and `/private/tmp/s6-*` paths when present

Normal `~/.cursor/extensions` contained no `test.s6-languageclient-smoke` entry and was not modified.

## Discharge

S6 is **discharged** for step 5.2: pin `vscode-languageclient` at major 10 (10.1.1 verified) and keep `engines.vscode: ^1.128.0`. Local VSIX install through the Cursor CLI works. Host import is verified through the official `@vscode/test-cli` + `@vscode/test-electron` path with `extensionDevelopmentPath` and `--disable-extensions`.
