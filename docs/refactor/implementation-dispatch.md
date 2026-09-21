# Implementation dispatch

This is the execution layer on top of [`fusion-lsp-plan.md`](fusion-lsp-plan.md). The plan remains the spec: contracts, file lists, verification, spikes, and Confirm gates. This file says how work is implemented serially, pipelined through review and CI, and landed.

## Trunk

`main` is the default branch. `origin/master` is the pre-fork GitHub default and is not trunk.

Every product step is one feature bookmark and pull request against `main`. A bookmark normally contains several ordered jj revisions: documentation in its own revision, configuration and lockfile changes in their own revision, and each production module or concern with its tests in a focused revision. Do not mix unrelated file groups to force the PR into one commit. The bookmark tip is the review and CI unit and must be complete and green. Do not dump revisions onto `fusion-lsp-client`; that bookmark is historical.

```bash
just jj new main
# implement one concern or file group
just jj commit -m "<focused revision>"
# repeat for the remaining concerns in this plan step
just check
just package   # when the PR changes packaging
just jj bookmark create <step-bookmark> --revision @-
just jj git push --bookmark <step-bookmark> --remote origin
gh pr create --base main --head <step-bookmark>
```

Merge from the pull request page. After merge: `just jj git fetch` and rebase the next local change onto `main` with `just jj rebase --source <next-change> --destination main`. Use `--skip-emptied` when rebasing a stack.

## Serial implementation, pipelined landing

Implement one PR at a time. Revisions within that PR are serial too. External review and CI for PR N do not block local implementation of PR N+1: after N's bookmark tip is locally green, passes the local read-only review, and is pushed, create N+1 as a child of N's bookmark tip in a separate jj workspace. Do not push N+1 until N has passed external review and CI and merged into `main`.

```bash
just jj workspace add ../fusion-pu-<next-step> --revision <step-bookmark> -m "<next-step subject>"
```

The local revision chain records dependency order within and across PRs. If review or CI rewrites any revision in N, jj rebases its descendants. If a fix is a new revision on N instead, move N+1 with `just jj rebase --source <n+1-root> --destination <step-bookmark>`. After N merges, fetch, rebase the full N+1 revision range onto `main`, resolve only real conflicts, rerun the bookmark-tip gates, then push it. A dependent bookmark must never reach the remote before its parent is merged.

Run `just sync` inside each new workspace. After rebasing its successor off a merged PR, forget the merged workspace, remove its directory, and abandon the obsolete local revision range with `just jj abandon <pr-root>::<pr-tip>`.

Review agents are read-only and may run while the next implementation proceeds. CI investigation and review fixes interrupt the next step only long enough to repair or rebase the affected ancestor. Do not open multiple implementation changes for parallel coding.

## Agent orchestration loop

The parent session is the orchestrator. Dispatch initial implementation and accepted review fixes to a fast coding agent (currently Composer 2.5). Dispatch detailed, skeptical review to a different higher-reasoning model (currently Claude Opus 5). The orchestrator then performs a quick evidence check, declines false positives and scope creep, and resumes the same coding agent with only accepted findings. Repeat until the bookmark tip is green and the detailed reviewer has no blockers.

Implementers work only in their assigned workspace and use `just jj status`, `just jj diff`, `just jj log`, and `just jj commit` to create the focused revisions in that PR. They run the named gates but do not create bookmarks, push, open PRs, or mutate another workspace.

Reviewers are read-only. They use `just jj diff`, `just jj show`, and `just jj log` to review the complete bookmark range and its revision boundaries. They return detailed, severity-ranked findings with file and line evidence; they do not edit, rewrite revisions, or push.

After the initial implementation for PR N is locally reviewed and pushed, the orchestrator may dispatch PR N+1 to the fast coding agent in a dependent local workspace while external review and CI run for N. Repairs to N take priority; after each repair, rebase the dependent workspace and resume its implementation.

## Agent contract

1. Read `CONTEXT.md`, the ADRs named by the step, this file, and the matching section of `fusion-lsp-plan.md`. Use the vocabulary: Declared Project, Dependency Project, Project Context, Local Capability, Hosted Capability, Consumer Repository.
2. This is **product** work. The shipped extension (`src/`, `webview_panels/`, `package.json` contributions) must not invoke `mise` or `just`, read `mise.toml`, or assume a Consumer Repository layout.
3. TDD at the seam the step names. Split the PR into focused revisions by concern and file group; keep implementation and its focused tests together. Put plan or user documentation in a separate revision. The bookmark tip must pass `just check`, plus `just package` when packaging changes.
4. No issue or PR numbers in code. Lines under 120 characters. Markdown: one physical line per prose paragraph.
5. Ponytail: shortest working diff after reading the real call graph. Do not port code the plan says to delete later. Do not add shims the plan forbids (especially a no-op telemetry sink).
6. Version control is `just jj …` only. Do not `git commit`, `git checkout -b`, or `git push`. The parent session owns revision shaping, rebases, bookmarks, and PR creation. A bookmark rooted directly on `main` may open immediately; a dependent bookmark opens only after its parent PR merges.
7. Stop at **Confirm** gates. Spikes write their evidence under `docs/refactor/` or `docs/adr/` as the plan names.

A reviewer reads the full bookmark diff against the step's contract and this checklist, then checks that revision boundaries are coherent. Fix blockers in the appropriate revision with `just jj edit`, `just jj squash`, or a focused follow-up revision before pushing. External PR review and CI may overlap only with implementation of the single next local PR.

## Current position

Steps 1.2 through 3.7 are on `main`. Complete the booked dependency follow-ons serially, using the pipelined landing workflow above, before Phase 4. The product is still manifest-driven; Core and Cloud classes remain because Fusion still extends Cloud.

**Correction to the plan's file path for 1.2:** `DBTFusionCommandDetection` lives in `@altimateai/dbt-integration`, not `src/dbt_client/dbtFusionCommandIntegration.ts`. Do not patch `node_modules`. Put `parseFusionVersion` / `judgeFusionVersion` in `src/fusion/fusionVersion.ts` and wrap detection in this extension (new adapter bound in `src/inversify.config.ts`, or a wrap of `DBTClient.detectDBT`). The library class can stay until Phase 8.

**Correction for 1.3:** collaborators are constructed by Inversify before `activate()`. An early return in `activate()` cannot un-construct them. The contract is: decide conflict and `enabled` before `detectDBT()`, before `initializeDBTProjects()`, before MCP start, before watchers and status bars initialize, and before any notification other than the conflict error. Do not re-architect the container in this step.

## File-overlap reference

| Work                  | Primary files                                                                        | Ordering and conflict boundary     |
| --------------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| Dependency follow-ons | package manifests, lockfiles, host and webview configuration, affected modules       | serial; all land before Phase 4    |
| 4.x Declared Project  | `src/projects/**`, `src/dbt_client/dbtWorkspaceFolder.ts`, `queryManifestService.ts` | serial 4.1 → 4.4                   |
| 5.x LSP               | `src/lsp/**`, `src/fusion/fusionExecutable.ts`, language-provider deletions          | after Phase 4 and the named spikes |
| 6–10                  | as the spec                                                                          | sequential; stop at Confirm gates  |

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

Pin Fusion in the container first (3.1) while leaving Core and Cloud classes in the tree. Then notebooks, AI, MCP, collaboration, telemetry — in that order. Telemetry: delete call sites; no silent sink. `docGenService.ts` is split, not deleted. After 3.6, step 3.7 upgrades or replaces remaining npm deps. The only compatibility ceiling is the VS Code / Cursor Extensions API (`engines.vscode`, `@types/vscode`). CommonJS, Inversify 6/7, React 18, and ESLint 8/9 are not freezes. Fusion in `mise.toml` stays 2.0.5. Complexity lint stays diagnostic and is not that PR.

### Phases 4–10

Unchanged from the spec. Hard-to-reverse: 6.3, all of 8, 9.1. Each is preceded by a release. Spikes S1–S6 before the steps that name them. Confirm D3 before 5.5; S2 inventory before Phase 7; consumer soak before Phase 8; all seven characterization cases before 10.4.

## Reviewer checklist

- Contract types and tests match the spec, including the two path corrections above.
- No mise/just leak into the shipped extension.
- Focused revisions by concern and file group; docs are separate; the bookmark tip has green `just check`.
- No leftover `as` assertions where shoehorn or real types exist; no speculative files.
- Bookmark is not `main` or `fusion-lsp-client`.
