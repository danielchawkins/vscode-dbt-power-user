# Implementation dispatch

This is the execution layer on top of [`rearchitecture-plan.md`](rearchitecture-plan.md) and [`quality-and-lsp-plan.md`](quality-and-lsp-plan.md). The plan is the spec: goals, exits, verification, and order. This file says how work is implemented serially, pipelined through review and CI, and landed.

## Trunk

`main` is the default branch. `origin/master` is the pre-fork GitHub default and is not trunk.

Every product step is one feature bookmark and pull request against `main`. A bookmark normally contains several ordered jj revisions: documentation in its own revision, configuration and lockfile changes in their own revision, and each production module or concern with its tests in a focused revision. Do not mix unrelated file groups to force the PR into one commit. The bookmark tip is the review and CI unit and must be complete and green.

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

Implement one PR at a time, except under [Parallel workspaces](#parallel-workspaces). Revisions within that PR are serial too. External review and CI for PR N do not block local implementation of PR N+1: after N's bookmark tip is locally green, passes the local read-only review, and is pushed, create N+1 as a child of N's bookmark tip in a separate jj workspace. Do not push N+1 until N has passed external review and CI and merged into `main`.

```bash
just jj workspace add ../fusion-pu-<next-step> --revision <step-bookmark> -m "<next-step subject>"
```

The local revision chain records dependency order within and across PRs. If review or CI rewrites any revision in N, jj rebases its descendants. If a fix is a new revision on N instead, move N+1 with `just jj rebase --source <n+1-root> --destination <step-bookmark>`. After N merges, fetch, rebase the full N+1 revision range onto `main`, resolve only real conflicts, rerun the bookmark-tip gates, then push it. A dependent bookmark must never reach the remote before its parent is merged.

Run `just sync` inside each new workspace. After rebasing its successor off a merged PR, forget the merged workspace, remove its directory, and abandon the obsolete local revision range with `just jj abandon <pr-root>::<pr-tip>`.

Review agents are read-only and may run while the next implementation proceeds. CI investigation and review fixes interrupt the next step only long enough to repair or rebase the affected ancestor.

## Parallel workspaces

At most two implementation workspaces run at once, and only for steps the plan marks parallel-safe: they touch none of the same files and none of the plan's shared files. Each parallel bookmark roots on the same parent tip and rebases after its sibling merges. Every other step is serial as above, and one smoke or integration run at a time still applies.

## Agent orchestration loop

The parent session is the orchestrator. Dispatch initial implementation and accepted review fixes to a fast coding agent (currently Composer 2.5). Dispatch detailed, skeptical review to a different higher-reasoning model (currently Claude Opus 5). The orchestrator then performs a quick evidence check, declines false positives and scope creep, and resumes the same coding agent with only accepted findings. Repeat until the bookmark tip is green and the detailed reviewer has no blockers.

Implementers work only in their assigned workspace and use `just jj status`, `just jj diff`, `just jj log`, and `just jj commit` to create the focused revisions in that PR. They run the named gates but do not create bookmarks, push, open PRs, or mutate another workspace.

Reviewers are read-only. They use `just jj diff`, `just jj show`, and `just jj log` to review the complete bookmark range and its revision boundaries. They return blockers and should-fix findings with file and line evidence; they do not edit, rewrite revisions, or push.

Reviewers send only blockers and should-fix findings back to the implementer. A blocker breaks behaviour, security, data, or the step's exit; a should-fix is a correctness or contract gap a user or the next step would hit. Every other finding is a nitpick: the reviewer appends it as one comment per review (file:line, finding, suggested fix) to the open issue labelled `nitpick` with `gh issue comment`, creating the issue if none is open, and does not return it for fixing. A sweep PR clears the nitpick issue as its own step.

## Gate cadence

Gates cost minutes each and slow every agent sharing the machine, so run each one when it can change a decision, not after every edit.

- **While iterating:** the narrowest check that covers the edit, such as one Vitest file, `tsc -b`, or ESLint on the touched files.
- **Before an implementer reports done:** `just check` once on the final tip, then `just smoke` once (`just smoke-visual` instead for a visible change). Both are required to claim done, and once each is enough when they pass.
- **Integration suite:** once before done when the change touches `src/fusion/`, `src/projects/`, `src/dbt_integration/`, or the integration tests.
- **Per-revision gates:** only `tsc -b` and unit tests, and only when the revision lands on its own. A stack's revisions are checked at the tip.
- **One smoke at a time.** Smoke launches VS Code and Cursor and fails when the machine is loaded, so two workspaces never run smoke or the integration suite concurrently. The orchestrator does not rerun gates an implementer reported green unless the tree changed; CI is the next check.
- **Measurements and stress runs** (memory, load) are separate tasks and run once, not inside a fix loop.
- Run long gates detached from terminal input (`nohup sh -c '…' > log 2>&1 </dev/null`) so a stray interrupt does not abort them.

Every dispatch names the workspace, parent revision, plan step, required reads (`AGENTS.md`, `CONTEXT.md`, the step, and its ADR/research), in-scope and excluded concerns, intended revision boundaries, and exact gates. If a coding agent cannot preserve the jj stack after one focused correction, it stops and returns a checkpoint; the orchestrator performs revision surgery directly instead of repeatedly delegating it.

After the initial implementation for PR N is locally reviewed and pushed, the orchestrator may dispatch PR N+1 to the fast coding agent in a dependent local workspace while external review and CI run for N. Repairs to N take priority; after each repair, rebase the dependent workspace and resume its implementation.

## Agent contract

1. Read `CONTEXT.md`, the ADRs named by the step, this file, and the matching phase of `rearchitecture-plan.md`. Use the vocabulary: Declared Project, Dependency Project, Current Project, Project Snapshot, Local Capability, Hosted Capability, Consumer Repository.
2. This is **product** work. The shipped extension (`src/`, `webview_panels/`, `package.json` contributions) must not invoke `mise` or `just`, read `mise.toml`, or assume a Consumer Repository layout.
3. TDD at the seam the step names. Split the PR into focused revisions by concern and file group; keep implementation and its focused tests together. Put plan or user documentation in a separate revision. The bookmark tip must pass the gates in [Gate cadence](#gate-cadence) before the implementer reports done.
4. No issue or PR numbers in code. Lines under 120 characters. Markdown: one physical line per prose paragraph.
5. Ponytail: shortest working diff after reading the real call graph. Do not port code the plan says to delete later. Do not add shims the plan forbids (especially a no-op telemetry sink).
6. Version control is `just jj …` only. Do not `git commit`, `git checkout -b`, or `git push`. The parent session owns revision shaping, rebases, bookmarks, and PR creation. A bookmark rooted directly on `main` may open immediately; a dependent bookmark opens only after its parent PR merges.
7. Stop at **Confirm** gates. Experiments write their evidence under `docs/research/` or `docs/adr/` as the plan names.

A reviewer reads the full bookmark diff against the step's contract and this checklist, then checks that revision boundaries are coherent. Fix blockers in the appropriate revision with `just jj edit`, `just jj squash`, or a focused follow-up revision before pushing. External PR review and CI may overlap only with implementation of the single next local PR.

## Current position

[`rearchitecture-plan.md`](rearchitecture-plan.md) records a result under each completed phase and marks completed steps as done. Continue with the first step not marked done, serially, using the pipelined landing workflow above. Copy each step's goal, exit and verification from the plan; the plan's Verify line for each phase is the acceptance test.

**Research artifacts precede plan integration.** Stack reviewed research revisions directly beneath the plan revision that consumes them, so every link resolves and evidence changes remain independently reviewable.

**Hard-to-reverse steps** are the ones the plan names in its Risks section. Each is preceded by a prerelease, and none is batched with another step.

## Reviewer checklist

- Contract types and tests match the spec.
- No mise/just leak into the shipped extension.
- Focused revisions by concern and file group; docs are separate; the bookmark tip has green `just check`.
- No leftover `as` assertions where shoehorn or real types exist; no speculative files.
- Bookmark is not `main`.
