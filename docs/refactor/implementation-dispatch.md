# Implementation dispatch

This is the execution layer on top of [`fusion-lsp-plan.md`](fusion-lsp-plan.md). The plan remains the spec: contracts, file lists, verification, spikes, and Confirm gates. This file says how work is landed, which steps may run in parallel, and what an agent must produce.

## Trunk

`main` is the default branch. `origin/master` is the pre-fork GitHub default and is not trunk.

Every product step is one described jj change on a feature bookmark, opened as a pull request against `main`, reviewed, then merged. Do not dump commits onto `fusion-lsp-client`. That bookmark is historical.

```bash
just jj new main
# implement one plan step
just check
just package   # when the step changes packaging
just jj commit -m "…"
just jj bookmark create <step-bookmark> --revision @-
just jj git push --bookmark <step-bookmark> --remote origin
gh pr create --base main --head <step-bookmark>
```

Merge from the pull request page. After merge: `just jj git fetch` and rebase leftover work with `just jj rebase --branch <remaining-head> --onto main --skip-emptied`.

## Parallel workspaces

Concurrent agents must not share a working copy. Create a jj workspace from `main` for each in-flight step:

```bash
just jj workspace add ../fusion-pu-<step> --revision main -m "<step commit subject>"
```

Each workspace needs its own `just sync`. When the step is merged or abandoned, `just jj workspace forget <name>` and remove the directory.

Do not start a step whose files overlap an in-flight workspace. The overlap table below is the lock.

## Agent contract

1. Read `CONTEXT.md`, the ADRs named by the step, this file, and the matching section of `fusion-lsp-plan.md`. Use the vocabulary: Declared Project, Dependency Project, Project Context, Local Capability, Hosted Capability, Consumer Repository.
2. This is **product** work. The shipped extension (`src/`, `webview_panels/`, `package.json` contributions) must not invoke `mise` or `just`, read `mise.toml`, or assume a Consumer Repository layout.
3. TDD at the seam the step names. One commit. `just check` green. `just package` when packaging changes.
4. No issue or PR numbers in code. Lines under 120 characters. Markdown: one physical line per prose paragraph.
5. Ponytail: shortest working diff after reading the real call graph. Do not port code the plan says to delete later. Do not add shims the plan forbids (especially a no-op telemetry sink).
6. Version control is `just jj …` only. Do not `git commit`, `git checkout -b`, or `git push`. Do not push; the parent session opens the PR.
7. Stop at **Confirm** gates. Spikes write their evidence under `docs/refactor/` or `docs/adr/` as the plan names.

A reviewer then reads the workspace diff against the step's contract and this checklist. Blockers get fixed in the same change before the PR.

## Current position

Phase 0 and 1.1 are complete. **1.2**, **1.3**, and **2.1** are on `main`. Next: Phase 2.2 / 2.3 / 2.4 in parallel (see [`remaining-implementation.md`](remaining-implementation.md)), then Phase 3 strictly serial. The product is still manifest-driven and still contains Core, Cloud, hosted Altimate, telemetry, AI, MCP, and notebooks.

**Correction to the plan's file path for 1.2:** `DBTFusionCommandDetection` lives in `@altimateai/dbt-integration`, not `src/dbt_client/dbtFusionCommandIntegration.ts`. Do not patch `node_modules`. Put `parseFusionVersion` / `judgeFusionVersion` in `src/fusion/fusionVersion.ts` and wrap detection in this extension (new adapter bound in `src/inversify.config.ts`, or a wrap of `DBTClient.detectDBT`). The library class can stay until Phase 8.

**Correction for 1.3:** collaborators are constructed by Inversify before `activate()`. An early return in `activate()` cannot un-construct them. The contract is: decide conflict and `enabled` before `detectDBT()`, before `initializeDBTProjects()`, before MCP start, before watchers and status bars initialize, and before any notification other than the conflict error. Do not re-architect the container in this step.

## Overlap table

| Step                         | Primary files                                                                                                                                                     | May run beside                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1.2 Fusion version gate      | `src/fusion/fusionVersion.ts` (new), `src/test/suite/fusionVersion.test.ts` (new), detection wiring in `src/dbt_client/index.ts` and/or `src/inversify.config.ts` | 1.3, 2.1                                    |
| 1.3 Conflict + enabled       | `src/dbtPowerUserExtension.ts`, `package.json` (new `dbt.enabled` contribution until Phase 9), tests next to the existing extension suite                         | 1.2, 2.1                                    |
| 2.1 Fixtures                 | `src/test/fixtures/**` only                                                                                                                                       | 1.2, 1.3                                    |
| 2.2 Integration harness      | `src/test/integration/**`, `justfile` `test-integration` (already present)                                                                                        | after 2.1                                   |
| 2.3 Scoping characterization | `src/test/suite/projectScoping.test.ts`, reads `src/manifest/dbtWorkspaceFolder.ts` (file is currently `src/dbt_client/dbtWorkspaceFolder.ts`)                    | after 2.1                                   |
| 2.4 Metadata snapshot        | `src/test/suite/metadataContract.test.ts`, `src/manifest/parsers` / domain maps                                                                                   | after 2.1                                   |
| 3.x deletions                | wide `src/` and `webview_panels/`                                                                                                                                 | never parallel with another 3.x step        |
| 4.x Declared Project         | `src/projects/**`, `src/dbt_client/dbtWorkspaceFolder.ts`, `queryManifestService.ts`                                                                              | never parallel with 3.x or another 4.x step |
| 5.x LSP                      | `src/lsp/**`, `src/fusion/fusionExecutable.ts`, language-provider deletions                                                                                       | after Phase 4; spikes S1–S6 first as named  |
| 6–10                         | as the spec                                                                                                                                                       | sequential; see Confirm gates               |

## Step briefs (execute from the spec)

Copy the contract and verification from `fusion-lsp-plan.md`. The notes below are only the deltas an agent would otherwise get wrong.

### 1.2 — Fusion version gate

- Accept `dbt 2.0.5`. Reject Core's `installed: 1.x` block. Do not require the substring `dbt-fusion`.
- Verdicts: `ok`, `untestedMajor` (warn once per install per major via `ExtensionContext.globalState`), `tooOld`, `notFusion`, `notFound`.
- Tests in `src/test/suite/fusionVersion.test.ts` for those five stdout shapes. This closes consumer case 2.
- Resolving the binary still goes through PATH or a configured path; do not call mise.

### 1.3 — Conflict guard and enabled

- If `extensions.getExtension("innoverio.vscode-dbt-power-user")` is defined: one blocking error, action `workbench.extensions.uninstallExtension`, return. That is the only startup notification this step may add.
- Resource-scoped `dbt.enabled` (keep the upstream key until Phase 9) false: return equally early, silently.
- Tests: neither path calls `detectDBT` / `initializeDBTProjects` / MCP update. Closes consumer case 7.

### Phase 2

No production code. Fixtures are shared vocabulary; do not fork them per suite. `just test-integration` stays out of `just check`. Characterization tests that must fail today use `it.failing` / `xit` so `just check` stays green.

### Phase 3

Pin Fusion in the container first (3.1) while leaving Core and Cloud classes in the tree. Then notebooks, AI, MCP, collaboration, telemetry — in that order. Telemetry: delete call sites; no silent sink. `docGenService.ts` is split, not deleted.

### Phases 4–10

Unchanged from the spec. Hard-to-reverse: 6.3, all of 8, 9.1. Each is preceded by a release. Spikes S1–S6 before the steps that name them. Confirm D3 before 5.5; S2 inventory before Phase 7; consumer soak before Phase 8; all seven characterization cases before 10.4.

## Reviewer checklist

- Contract types and tests match the spec, including the two path corrections above.
- No mise/just leak into the shipped extension.
- One commit, green `just check`.
- No leftover `as` assertions where shoehorn or real types exist; no speculative files.
- Bookmark is not `main` or `fusion-lsp-client`.
