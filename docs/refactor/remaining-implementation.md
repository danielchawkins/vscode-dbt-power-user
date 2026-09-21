# Remaining implementation

This is the executor plan for work still ahead of `main`. Contracts, file lists, spikes, and Confirm gates stay in [`fusion-lsp-plan.md`](fusion-lsp-plan.md). Landing rules stay in [`implementation-dispatch.md`](implementation-dispatch.md). Do not invent vocabulary; use `CONTEXT.md`.

## Current `main`

Phase 0 and 1.1 are complete. Merged onto `main`:

| Step                     | What landed                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.2 Fusion version gate  | `src/fusion/fusionVersion.ts` plus PATH-only `FusionVersionDetection`. Accepts `dbt 2.0.5`. Untested major warns once to the terminal via `globalState`. Missing binary is `notFusion` / ENOENT debug, not a `notFound` verdict. |
| 1.3 Conflict + `enabled` | Early return in `activate()` before `detectDBT` / MCP / status. Conflict is the only startup notification. `enabled` is false only when every folder is disabled.                                                                |
| 2.1 Fixtures             | `src/test/fixtures/{single-project,multi-root,nested-project}` with `profile:` and dummy `profiles.yml`. Smoke in `fixturesSmoke.test.ts`. `src/test/fixtures/**/target/` is gitignored.                                         |
| 2.2–2.4                  | Integration harness, scoping characterization, metadata contract snapshot.                                                                                                                                                       |
| 3.1–3.6                  | Fusion-only factories; notebooks, AI/DataPilot, MCP, collaboration, telemetry deleted.                                                                                                                                           |

The product is still manifest-driven. Core and Cloud classes remain because Fusion still extends Cloud. `DBTFusionCommandDetection` still lives in `@altimateai/dbt-integration`; do not patch `node_modules`.

## How to land a step

Product context: the shipped extension never invokes `mise` or `just`, never reads `mise.toml`, and never assumes a Consumer Repository layout.

```bash
just jj workspace add ../fusion-pu-<step> --revision main -m "<one-line subject>"
cd ../fusion-pu-<step>
just sync
# implement one plan step, TDD at the named seam
just check
just package   # only when packaging or contributions change
just jj commit -m "…"
just jj bookmark create <step-bookmark> --revision @-
```

Do not `git commit`, `git checkout -b`, or `git push`. The parent session pushes, opens `gh pr create --base main`, waits for review fixes, and merges. One described change per step. Reviewers read the workspace diff against the spec contract; blockers are folded into the same change before the PR.

## Gotchas that already bit us

- `DBTFusionCommandDetection` is not in `src/dbt_client/dbtFusionCommandIntegration.ts`. Wrap it in this extension.
- Collaborators are constructed before `activate()`. An early return cannot un-construct them; it can only skip later work.
- `src/manifest/dbtWorkspaceFolder.ts` in the spec is `src/dbt_client/dbtWorkspaceFolder.ts` on disk.
- `just test-integration` already exists and already runs `@vscode/test-electron` over `src/test/integration/**/*.test.ts` (formatter / sqlfmt / run-history). Step 2.2 extends that harness; it does not replace it or pull it into `just check`.
- Fusion 2.x `--version` is `dbt 2.0.5`, not `dbt-fusion`. Configured-path resolution is step 5.1, not 1.2.
- Decision 9: silent startup except the 1.3 conflict error. Do not add toasts in later steps; status bar, output channel, or Problems.
- Untested-major `notFound` was dropped from the 1.2 type because PATH miss is already `notFusion`. Step 5.1 reintroduces a blocking missing-path verdict on the configured path.

## Batch 1 — finish Phase 2 (parallel)

All three may run beside each other after 2.1. None may edit production runtime behavior.

### 2.2 — Integration harness

**Workspace:** `../fusion-pu-2-2`. **Bookmark:** `test/integration-harness`.

**Touch:** `src/test/integration/` (add, do not delete existing formatter tests), `src/test/integration/lspFixture.ts` (new), helpers to open a fixture workspace, wait for activation, read diagnostics, request completions, and `executeCommand`. Keep `just test-integration` out of `just check`. If the recipe needs a Fusion-skip message, put that in the new tests / `lspFixture`, not by making `just check` spawn Electron.

**Contract:** `just test-integration` requires pinned Fusion on `PATH` and skips with a clear message otherwise. `lspFixture.ts` spawns `dbt lsp` against a fixture and speaks LSP over the reverse socket without the extension.

**Verify:** one integration test asserts the extension activates on `single-project` and that `dbt --version` resolves to Fusion 2.0.5. Existing sqlfmt integration tests still run when `SQLFMT_PATH` is set. `just check` stays green without Electron.

**Do not:** implement reverse-socket production code (`src/lsp/` is Phase 5); call `mise`; download VS Code in `just check`.

### 2.3 — Project scoping characterization

**Workspace:** `../fusion-pu-2-3`. **Bookmark:** `test/project-scoping-characterization`.

**Touch:** `src/test/suite/projectScoping.test.ts` (new). Read `src/dbt_client/dbtWorkspaceFolder.ts` (not `src/manifest/`). Use the 2.1 fixtures. No production edits.

**Contract:** encode consumer cases 3–6 as tests: folder-scoped setting wins over window-level; a file outside any project must still resolve a Project Context; a copied project tree must not register; a workspace folder without a root `dbt_project.yml` registers nothing and creates no watcher. Mark cases that fail against today's discovery with `it.failing` (or `xit` naming the Phase 4 step that will fix them) so `just check` stays green.

**Verify:** the suite runs and reports the expected failures; `just check` green.

**Do not:** start `src/projects/` or delete `allowListFolders`. That is Phase 4.

### 2.4 — Metadata contract snapshot

**Workspace:** `../fusion-pu-2-4`. **Bookmark:** `test/metadata-contract-snapshot`.

**Touch:** `src/test/suite/metadataContract.test.ts` (new). Drive existing parsers on `single-project`'s `manifest.json`. Snapshot `NodeMetaMap`, `MacroMetaMap`, `SourceMetaMap`, `GraphMetaMap`, and `TestMetaMap` *shape and key set*, not absolute paths or checksums.

**Contract:** this snapshot is the Phase 6 acceptance test for both producers. Generate `manifest.json` in the test if missing (fixtures gitignore `target/`); do not commit `target/`.

**Verify:** snapshot committed; suite green; `just check` green.

**Do not:** introduce `ProjectMetadataSource`. That is 6.1.

## Batch 2 — Phase 3 deletions (strictly serial)

Start only after Batch 1 is on `main`. Never run two 3.x steps in parallel. Order is load-bearing: 3.1 shrinks 3.2–3.6.

| Step | Bookmark                      | One-line job                                                                                                                                                                                                             |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.1  | `feat/pin-fusion-integration` | Collapse `inversify.config.ts` factories to Fusion only. Remove `dbt.dbtIntegration` and switch/install commands. Leave Core and Cloud classes in the tree.                                                              |
| 3.2  | `feat/remove-notebooks`       | Delete notebook kernel, ZeroMQ, `postInstall.js` / `prepareBuild.js`. VSIX must contain no `.node` files. `just package`.                                                                                                |
| 3.3  | `feat/remove-ai-datapilot`    | Delete DataPilot / AI panels and commands. Split `docGenService.ts`: AI paths go, local schema-YAML scaffolding stays.                                                                                                   |
| 3.4  | `feat/remove-mcp`             | Delete `src/mcp/` and MCP settings/deps.                                                                                                                                                                                 |
| 3.5  | `feat/remove-collaboration`   | Delete comments, users, insights, hosted docs, healthcheck, BigQuery cost. Keep remaining `AppRoutes`.                                                                                                                   |
| 3.6  | `feat/remove-telemetry`       | Delete `src/telemetry/` and every `TelemetryService` parameter. No no-op sink. Replace sole-error telemetry with `DBTTerminal`. Then tag `0.1.0-alpha.1` only after 9.4's release workflow exists or is brought forward. |

Confirm: `grep` emptiness as named in the spec. Telemetry is 51 files; keep the diff mechanical.

### After 3.6 — latest majors, then diagnostic lint

Start only after 3.6 is on `main`. Bookmark `chore/latest-majors` for the first PR; further majors/replacements get their own bookmarks. Do not start Phase 4 until 3.7 and those booked follow-ons are on `main`. Do not run them beside 4.x.

**Ceiling:** `engines.vscode` and `@types/vscode` are the newest Extensions API both VS Code and Cursor support (Confirm if they diverge). That is the only compatibility constraint. Installed Cursor reports `vscodeVersion` 1.128.0; VS Code is 1.137.0; take 1.128 for `engines.vscode`. `@types/vscode` has no 1.128 publish (1.125 then 1.136+); pin `1.125.0` so types do not float above that API. The host may become ESM. Inversify, React, ESLint, TypeScript, and the rest take the current major or a replacement.

**Job:** every remaining direct npm dependency (root and `webview_panels`) to the newest published major as `^x.y.z`. Drop exact versions, tildes, and tighter-than-caret ranges, except `@types/vscode`. Replace a package that is unmaintained or cannot take the current major (do not pin an old major and call it a host-shape freeze). Migrate `moduleResolution` off `node`/`node10`. No `"ignoreDeprecations"`. Refresh lockfiles with `just update` (or equivalent), re-review `allowScripts`, `just check` and `just package` green.

**Engines:** `engines.node` is `>=<current LTS major> <next major>`. mise contributor CLIs already track `latest`; Fusion stays `2.0.5` in `mise.toml` — product minimum, not a library to float. SHA-pin GitHub Actions stay SHA-pinned.

**Do not:** add complexity lint in these PRs; delete Core/Cloud classes; bump Fusion; treat CommonJS as inviolable.

**Held in 3.7, booked as own PRs before Phase 4:** Tailwind 4 (class prefix `al-` becomes a variant; `@source` for `@altimateai/ui-components`; Vite 8 `cssMinify: "esbuild"` until lightningcss accepts the output); ESM host plus Inversify 8; webview ESLint 10 (replace `eslint-plugin-react` / `eslint-plugin-import` / `eslint-plugin-jsx-a11y` if they stay on ESLint 9); React 19 (replace `@altimateai/ui-components` and `@ant-design/pro-chat` which peer on React 18 / antd 5); `@finos/perspective*` to `@perspective-dev/*`. TypeScript 7 when `typescript-eslint` supports it.

After the last booked majors PR, evaluate a report-only `just lint-complexity` (ESLint `complexity` / `max-depth` or sonarjs). Prefer warn or a non-failing recipe. Do not add it to `just lint`, `just check`, Lefthook pre-push, or CI. Promoting it to a gate needs a later Confirm, and not before Phase 8 at the earliest.

## Batch 3 — Phase 4 Declared Projects (strictly serial)

Start only after Phase 3 and 3.7. Never parallel with 3.x, 3.7, or another 4.x step.

| Step | Bookmark                      | Turns green                                                                                                                                                                    |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1  | `feat/declared-project-roots` | `src/projects/projectConfiguration.ts`. Cases 3, 5, 6.                                                                                                                         |
| 4.2  | `feat/project-registry`       | `src/projects/projectRegistry.ts` replaces workspace-folder discovery. Two projects on `multi-root`; no recursive watchers.                                                    |
| 4.3  | `feat/project-context`        | `src/projects/projectContext.ts`. Rewire `QueryManifestService` without changing its 21 call-site signatures. Case 4.                                                          |
| 4.4  | `feat/retire-discovery`       | Delete `dbtWorkspaceFolder.ts` and the three `DBTProjectDetection` classes. Remove `dbt.allowListFolders`. Scoping suite passes without `it.failing`. Release `0.2.0-alpha.0`. |

## Batch 4 — spikes, then Phase 5 LSP

Do not start 5.x until Phase 4 is on `main`. Run spikes first as named; each spike is its own bookmark and PR of evidence only.

| Spike | Before          | Output                                                                                                                                    |
| ----- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S6    | 5.2             | Cursor loads chosen `vscode-languageclient` major; `cursor --install-extension` accepts a local VSIX.                                     |
| S2    | 5.3 and Phase 7 | `docs/refactor/lsp-commands.md` request/response JSON. Confirm `show` / `previewCte` / `goToDefinition` and `--command-prefix` semantics. |
| S3    | 5.3             | Per-project `RelativePattern` documentSelector isolation, including `target/` and files with no folder.                                   |
| S4    | 5.3             | Memory/startup for one and two `dbt lsp`; SIGTERM vs socket close; reload orphans; SIGKILL grace.                                         |
| S5    | 5.3             | Coexistence with `dbtlabs.dbt`. Prefix vs second conflict guard.                                                                          |
| S1    | 5.5             | Resolve **D3** in `docs/adr/0005-dependency-diagnostics.md`.                                                                              |

Then serial 5.1 → 5.6. 5.1 is the first production configured-path resolver (`src/fusion/fusionExecutable.ts`). 5.2 is reverse-socket (`src/lsp/reverseSocketTransport.ts`), vscode-free except `Disposable`. 5.3 is client + pool with mandatory `--command-prefix`. 5.4 is status/output and the permanent zero-notification spy test. 5.5 implements a diagnostics filter only if S1 requires it. 5.6 deletes the five provider directories. Release `0.3.0-alpha.0`.

## Batch 5 — Phases 6–10 (serial, Confirm gates)

| Gate           | Stop until                                                              |
| -------------- | ----------------------------------------------------------------------- |
| Before 5.5     | S1 / D3                                                                 |
| Before Phase 7 | S2 inventory; name any retained feature with no command and no artifact |
| Before Phase 8 | beta.2 soaked on `finance-pipelines`                                    |
| Before 10.4    | all seven consumer characterization cases green through the fork        |

Hard-to-reverse, each preceded by a release: 6.3 (delete parsers), all of 8, 9.1 (namespace rename). Do not batch those with another step.

6.1 must not change consumer files. If it must, stop: the metadata event is the wrong boundary.

Phase 10 is work in `/Users/daniel/projects/finance-pipelines` with that repo's `gh stack` skill, not this repo's feature-PR loop.

## Reviewer checklist (every PR)

- Matches the named step's contract and verification, including path corrections in the dispatch doc.
- One commit. Bookmark is not `main` or `fusion-lsp-client`.
- No mise/just in `src/`, `webview_panels/`, or `package.json` contributions.
- No issue or PR numbers in code. Lines under 120 characters. Markdown prose is one physical line per paragraph.
- Ponytail: no files the plan says to delete later; no telemetry shim; no 5.1 resolver inside 2.x tests beyond PATH checks.
- `just check` green. `just package` when packaging changed.
