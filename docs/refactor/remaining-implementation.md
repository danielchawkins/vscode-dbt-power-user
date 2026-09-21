# Remaining implementation

This is the executor plan for work still ahead of `main`. Contracts, file lists, spikes, and Confirm gates stay in [`fusion-lsp-plan.md`](fusion-lsp-plan.md). Landing rules stay in [`implementation-dispatch.md`](implementation-dispatch.md). Do not invent vocabulary; use `CONTEXT.md`.

## Current position

**Completed at this tip:** 1.2 version gate, 1.3 conflict guard and `enabled`, all of Phase 2, steps 3.1 through 3.15, and Phase 4.1's folder-scoped Declared Project resolver. The extension packages as `0.1.0-alpha.0` against the 1.128 Extensions API with webview compiled for Chromium 148.

**Completed evidence:** pinned VS Code 1.128.0 and unauthenticated Cursor 3.21.16 each record all three host activation phases, real-webview FCP, and host resolve-to-ready across ten fresh processes. Webview target is now `chrome148` with `rolldownOptions`, and the Tailwind guard retains 543 base selector tokens.

**Next:** Phase 4.2 replaces recursive discovery with the Project Registry.

What is still true of the product: it is manifest-driven, and it still ships hosted Altimate, authentication, credits, and Python-bridge paths. Core and Cloud stay constructible because `DBTProjectIntegrationAdapter`'s constructor requires their factories — **not** because Fusion extends Cloud, which it does not. `DBTFusionCommandDetection` and the integration classes live in `@altimateai/dbt-integration`; wrap them, never patch `node_modules`.

A React 19 attempt was abandoned for vendoring generated output into `src/`, and React is **not** scheduled as a selected target: D6 decides the runtime at v2.2. Vendoring generated output is prohibited outright — generated CSS or JavaScript may arrive through a package's `exports`, never as a committed copy.

## How to land a step

Product context: the shipped extension never invokes `mise` or `just`, never reads `mise.toml`, and never assumes a Consumer Repository layout.

```bash
just jj workspace add ../fusion-pu-<step> --revision <parent-bookmark> -m "<one-line subject>"
cd ../fusion-pu-<step>
just sync
# implement one plan step, TDD at the named seam
# finish each concern or file group as a focused revision
just jj commit -m "<focused revision>"
# repeat until the PR bookmark is complete
just check
just package   # only when the PR changes packaging or contributions
```

Implementation is serial: only one PR is being coded at a time, and its revisions are built in order. Split docs, configuration, and distinct modules or concerns into focused revisions; keep each concern's tests with its implementation. The complete bookmark tip, not every intermediate revision, is the required green unit.

External review and CI do not create idle time. Once PR N is locally green, passes the local read-only review, and is pushed, begin PR N+1 locally as a child of N's bookmark tip in another jj workspace. If N is rewritten, jj rebases descendants. If a fix is added on top of N, run `just jj rebase --source <n+1-root> --destination <parent-bookmark>`. After N merges, rebase the full N+1 revision range onto `main`, rerun its gates, then push its bookmark. Never push a dependent PR before its parent merges.

Do not `git commit`, `git checkout -b`, or `git push`. The parent session owns revision shaping, rebases, bookmarks, pushes, PR review fixes, CI repairs, and merges. Reviewers read the full bookmark diff and its revision boundaries against the spec contract.

For each PR, use the dispatch document's loop: fast coding agent for implementation, separate higher-reasoning agent for detailed read-only review, orchestrator evidence check, then resume the same coding agent for accepted fixes. Every agent inspects revisions with `just jj`; only implementers create revisions, and only the orchestrator publishes them.

## Gotchas that already bit us

- `DBTFusionCommandDetection` is not in `src/dbt_client/dbtFusionCommandIntegration.ts`. Wrap it in this extension.
- Collaborators are constructed before `activate()`. An early return cannot un-construct them; it can only skip later work.
- There is no `src/manifest/` and no `src/domain.ts`. Discovery is `src/dbt_client/dbtWorkspaceFolder.ts`, the metadata event is `src/dbt_client/event/manifestCacheChangedEvent.ts`, and the map types and parsers come from `@altimateai/dbt-integration`.
- `just test-integration` already exists and already runs `@vscode/test-electron` over `src/test/integration/**/*.test.ts` (formatter / sqlfmt / run-history). Step 2.2 extends that harness; it does not replace it or pull it into `just check`.
- Fusion 2.x `--version` is `dbt 2.0.5`, not `dbt-fusion`. Configured-path resolution is step 5.1, not 1.2.
- Decision 9: silent startup except the 1.3 conflict error. Do not add toasts in later steps; status bar, output channel, or Problems.
- Untested-major `notFound` was dropped from the 1.2 type because PATH miss is already `notFusion`. Step 5.1 reintroduces a blocking missing-path verdict on the configured path.

## Dependency follow-ons before Phase 4

Serial PRs, each carrying the constraints below. Do not start Phase 4 until every booked follow-on is on `main`.

**Ceiling:** `engines.vscode` and `@types/vscode` are the newest Extensions API both VS Code and Cursor support. The compatibility Confirm is discharged by merged step 3.7: installed Cursor reports `vscodeVersion` 1.128.0 and VS Code is 1.137.0, so `engines.vscode` uses their 1.128 intersection. `@types/vscode` has no 1.128 release; pin 1.125.0 exactly so types do not float above the host API. The webview has a second, separate ceiling — Chromium 148, derived from VS Code 1.128.0's Electron 42.5.0 — and it is set in step 3.15, after step 3.14's smoke job proves both hosts.

**Job:** every remaining direct npm dependency (root and `webview_panels`) takes the newest published major as `^x.y.z`, except the API types pin above. Replace a package that is unmaintained or cannot take the current major. No `"ignoreDeprecations"`. Refresh lockfiles, re-review `allowScripts`, and keep `just check` and `just package` green.

**Engines:** `engines.node` is `>=<current LTS major> <next major>`. mise contributor CLIs already track `latest`; Fusion stays `2.0.5` in `mise.toml` — product minimum, not a library to float. SHA-pin GitHub Actions stay SHA-pinned.

**Do not:** add complexity lint in these PRs; delete the Core or Cloud factories, which the external adapter's constructor still requires; bump Fusion; treat CommonJS as inviolable; vendor generated output; settle **D6**, **D7**, or **D8** by writing a framework, a renderer, or a Tailwind decision into one of these PRs.

**Booked, in order.** Each row is one bookmark and one PR, independently green at its tip. Contracts, file lists, and verification for 3.8 through 3.15 are in the plan.

| #  | PR                                                    | Contents                                                                                                                                                                                                 | Depends on |
| -- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1  | Tailwind guard, blocker                               | Merged. The regression guard plus evidence that the `al-` generation cannot move to v4 while its consumer ships v3 class strings. Records **D8**; does not resolve it.                                   | —          |
| 2  | Webview ESLint 10                                     | Merged. Native ESLint 10 config, supported plugins, stable correctness/a11y rules, and an exact warning ratchet.                                                                                         | 1          |
| 3  | 3.8 code block and `noop`                             | Merged. Local CodeBlock capability preserving its prop interface; local `noop` replaces the documentation editor's internal Ant import.                                                                  | 2          |
| 4  | 3.9 hosted webview cut                                | Merged. Hosted routes/providers and `webview_panels/src/lib/` are gone; retained validate/install commands resolve projects through the picker.                                                          | 3          |
| 5  | 3.10 dependency pruning                               | Merged. Zero-reference and vendored-bundle dependencies are removed; remaining advisories belong to lineage and Perspective.                                                                             | 4          |
| 6  | 3.11 image audit                                      | Merged. Reference-audited asset deletion with an exact runtime/contribution icon guard.                                                                                                                  | 4          |
| 7  | 3.12 Codicons allowlist                               | Merged. Copy only `codicon.css` and `codicon.ttf` from the plugin.                                                                                                                                       | —          |
| 8  | 3.13 tests and baselines                              | Merged. Vitest/Testing Library tests against current seams plus reproducible single-entry payload and build/package baselines.                                                                           | 3          |
| 9  | 3.14 host smoke + timing                              | Complete at this tip. Both pinned hosts have acquisition, packaged-VSIX smoke, metadata, and ten fresh-process activation/FCP/ready samples.                                                             | 8          |
| 10 | [3.15 browser target](step-3-15-vite-optimization.md) | Complete at this tip. Set `chrome148`, migrated to `rolldownOptions`, retained esbuild after the default minifier rejected invalid dependency-derived utilities, and preserved 543 base selector tokens. | 9          |

Deliberately not in this list: the shared message contract, which arrives at v2.1 as `packages/webview-contract/` together with the npm workspace that makes it resolvable, and must not be stubbed in v1 so a test can be written against it; React 19, which **D6** has not selected and which must not be adopted merely to unblock a dependency bump; `@finos/perspective*` to `@perspective-dev/*`, which is v2.5 behind its spike; and TypeScript 7 until `typescript-eslint` supports it.

After the last of these, evaluate a report-only `just lint-complexity` (ESLint `complexity` / `max-depth` or sonarjs). Prefer warn or a non-failing recipe. Do not add it to `just lint`, `just check`, Lefthook pre-push, or CI. Promoting it to a gate needs a later Confirm, and not before Phase 8 at the earliest.

## Phase 4 — Declared Projects

Start only after every dependency follow-on above is on `main`. Implement 4.1 through 4.4 serially.

| Step | Bookmark                      | Turns green                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `feat/declared-project-roots` | Complete at this tip. Resource-scoped `dbt.projects` plus the fail-closed resolver and cases 3, 5, and 6 at the configuration seam.                                                                                                                                                                                                                                                                                                      |
| 4.2  | `feat/project-registry`       | `src/projects/projectRegistry.ts` replaces workspace-folder discovery. Two projects on `multi-root`; no recursive watchers.                                                                                                                                                                                                                                                                                                              |
| 4.3  | `feat/project-context`        | `src/projects/projectContext.ts`. Rewire `QueryManifestService` without changing its 21 call-site signatures. Case 4.                                                                                                                                                                                                                                                                                                                    |
| 4.4  | `feat/retire-discovery`       | Delete `src/dbt_client/dbtWorkspaceFolder.ts`. `DBTProjectDetection` and its implementations are exports of `@altimateai/dbt-integration`, so remove their imports, container bindings, and composition in `src/inversify.config.ts` — there are no local class files to delete. Remove `dbt.allowListFolders`; replace obsolete workspace-folder tests with Project Registry coverage and remove `it.failing`. Release `0.2.0-alpha.0`. |

## Phase 5 — spikes, then LSP

Do not start 5.x until Phase 4 is on `main`. Each spike is its own bookmark and PR of evidence only, run before the step in its "Before" column; the table lists all ten here so none is discovered late, not because all ten precede Phase 5.

Spike privacy rules are in the plan and are conditions of running: synthetic fixtures for verbose traces, redaction at capture, no SQL or result retention, transient query ids, explicit opt-in for anything touching an account.

| Spike | Before            | Output                                                                                                                                               |
| ----- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6    | 5.2               | Cursor loads chosen `vscode-languageclient` major; `cursor --install-extension` accepts a local VSIX.                                                |
| S2    | 5.3, 6.2, Phase 7 | `docs/refactor/lsp-commands.md` request/response JSON for the migrated flows. Confirm `show` / `previewCte` / `goToDefinition` and prefix semantics. |
| S3    | 5.3               | Per-project `RelativePattern` documentSelector isolation, including `target/` and files with no folder.                                              |
| S4    | 5.3               | Memory/startup for one and two `dbt lsp`; SIGTERM vs socket close; reload orphans; SIGKILL grace.                                                    |
| S5    | 5.3               | Coexistence with `dbtlabs.dbt`. Prefix vs second conflict guard.                                                                                     |
| S1    | 5.5               | Resolve **D3** in `docs/adr/0005-dependency-diagnostics.md`.                                                                                         |
| S10   | **D5**, so 5.0    | Opt-in. Measured `baseline` versus `strict`, and how to detect a silent fallback.                                                                    |
| S8    | 6.0               | What the server does on `dbt_project.yml`, `profiles.yml`, and `dbt deps` changes — the producer-evidence list the epoch advances on.                |
| S7    | 7.1               | Whether the server writes `target/`; watcher-experienced race rate, separately labeled from writer vulnerability; duplicate-work evidence.           |
| S9    | 7.4               | Opt-in. Query-id availability, cancellation, `QUERY_TAG`, per-phase distributions.                                                                   |

Then serial 5.0 → 5.6. **5.0 is new and gated on D5**: `src/fusion/staticAnalysisMode.ts` carrying the configured mode, the effective mode with its fallback flag, the restart-on-change rule, and the capability matrix — the pool in 5.3 cannot assemble launch arguments without it. 5.1 is the first production configured-path resolver (`src/fusion/fusionExecutable.ts`). 5.2 is reverse-socket (`src/lsp/reverseSocketTransport.ts`), vscode-free except `Disposable`. 5.3 is client + pool with mandatory `--command-prefix`. 5.4 is status/output, including the effective-mode surface, and the permanent zero-notification spy test. 5.5 implements a diagnostics filter only if S1 requires it. 5.6 deletes the five provider directories. Release `0.3.0-alpha.0`.

## Phases 6–10 — serial with Confirm gates

6.0 stamps the publication epoch and producer identity onto `ManifestCacheProjectAddedEvent`, wraps extension-initiated requests so each captures the epoch and any document version before dispatch and rechecks both after completion, and starts the Fusion segment records. It adds no new interface and changes no consumer. 6.1 through 6.3 swap the producer behind the port. **7.1 then retires `DBTProjectIntegrationAdapter`**, which is what removes the ambient target watcher and the Cloud factory requirement together; 8.1 deletes Cloud and Core construction only after it.

| Gate           | Stop until                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Before 5.0     | **D5** — whether a user's own `dbt login` is recognized — resolved against S10's capability matrix |
| Before 5.5     | S1 / D3                                                                                            |
| Before 6.2     | S2 payload contract for the migrated flows                                                         |
| Before Phase 7 | S2 inventory; name any retained feature with no command and no artifact                            |
| Before 7.4     | S9 and S10 evidence for the warehouse- and `strict`-dependent features                             |
| Before Phase 8 | 7.1 merged; beta.2 soaked on `finance-pipelines`                                                   |
| Before 10.4    | all seven consumer characterization cases green through the fork                                   |
| Before v2.3    | **D6** and **D7** from v2.2's joint benchmark, plus the Perspective spike verdict                  |

Hard-to-reverse, each v1 one preceded by a release: 6.3 (flip the producer), 7.1 (retire the adapter), all of 8, 9.1 (namespace rename), and v2.3 (the lineage renderer). Do not batch those with another step.

6.1 must not change consumer files. If it must, stop: the metadata event is the wrong boundary.

Phase 10 is work in `/Users/daniel/projects/finance-pipelines` with that repo's `gh stack` skill, not this repo's feature-PR loop.

## v2 — the north-star horizon

Section 4 of the plan. **It starts after v1 is complete through Phase 10 and the 1.0.0 release**, with step 3.13's baseline recorded and step 3.14's smoke job green; the namespace, the distribution pipeline, and consumer adoption settle before any panel is rebuilt under them. Order: v2.1 the `packages/webview-contract/` message contract and the npm workspace that carries it, `LineageData`, per-panel entries, and `PanelHost`, with the panels unchanged; v2.2 the joint runtime and renderer benchmark against that baseline, resolving D6 and D7; v2.3 the selected renderer; v2.4 the styling contract per D8; v2.5 Perspective; v2.6 the runtime application with the token layer and UI-only panel persistence; v2.7 the React candidates only if the selected stack and its tests justify them; v2.8 the Playwright harness.

## Reviewer checklist (every PR)

- Matches the named step's contract and verification, including path corrections in the dispatch doc.
- Revisions separate docs, configuration, and distinct modules or concerns. Bookmark is not `main` or `fusion-lsp-client`.
- No mise/just in `src/`, `webview_panels/`, or `package.json` contributions.
- No issue or PR numbers in code. Lines under 120 characters. Markdown prose is one physical line per paragraph.
- Ponytail: no files the plan says to delete later; no telemetry shim; no 5.1 resolver inside 2.x tests beyond PATH checks.
- No generated output committed to `src/` or `webview_panels/src/`, and no patched `node_modules`.
- No new ambient watching of `target/`, no writes into any project's `target/`, no persisted compiler, schema, or result cache, and no second diagnostic store.
- No deferred decision settled in passing: D5 authentication, D6 runtime, D7 renderer, D8 Tailwind.
- No performance target that the harness did not produce.
- `just check` green. `just package` when packaging changed.
