# Why the strands runs failed, 2026-10-08/09

Evidence comes from the run logs under `<workspace>/.agents/sessions/<run>/` (`events.jsonl`, `result.json`), the plans store's `state.json` and `PROGRESS.md`, and the harness source at `data-utilities/agents-store/apps/agents/src/agents_runner/`. Line references are to that source on 2026-10-09.

## 1. Runs stopping with "no answer" (fixed)

**What happened.** The develop and architect runs on 2026-10-08 ended with `problems: ["no answer"]` while the work was half done. Examples:

| Run                                  | Tokens when it stopped |
| ------------------------------------ | ---------------------- |
| `20261008T151633-c4ff62` (upgrades)  | 2.85M                  |
| `20261008T160531-ceceef` (A1)        | 3.08M                  |
| `20261008T165437-abede4` (A2)        | 3.02M                  |
| `20261008T151633-188b18` (architect) | 643k                   |

**Why.** `structured.py:34` and `settings.py` `_default_limits()` cap each ask:

| Role        | Turns | Total tokens |
| ----------- | ----- | ------------ |
| default     | 30    | 600k         |
| implementer | 60    | 3M           |
| researcher  | 40    | 800k         |

When the cap is hit mid-task, `invoke` returns `(stopped at its total_tokens limit before answering)`. `verify.attempt` turns that into "no answer" (`verify.py:161`) and doesn't retry it. No workspace had a `.agents/strands.toml`, so the defaults applied.

**Fix applied.** `.agents/strands.toml`, gitignored, now sits in main and in ws-a–d with these budgets:

| Role                    | Turns | Total tokens |
| ----------------------- | ----- | ------------ |
| implementer             | 400   | 20M          |
| reviewer and researcher | 150   | 6M           |
| default                 | 120   | 4M           |

No run has stopped at a limit since.

## 2. Research run rejected immediately

**What happened.** `research` runs `20261008T203821` and `20261008T204330` ended after 0 s with "research needs a `question` and an `output` path inside the repo".

**Why.** `research.py` `_destination` resolves the output path, following symlinks, and requires it to stay inside the repo. `.agents/plans` is a symlink to `~/.local/state/agents/…/plans`, which is outside the repo.

**Fix applied.** Research now writes under `docs/research/`.

## 3. Shell guard blocking harmless commands (open; harness bug)

**What happened.** Across the runs in ws-a and ws-b, 105 tool calls were refused with "Version-control mutations are not allowed in the shell". Another 38 were refused with "Edit files with the edit or write tool, not the shell". Agents then spent turns working around the refusals. Planners and architects were hit worst: they have `workspace: read`, so no write tool, and the shell was their only way to save a plan file.

**Why.** `guard.py` `vcs_mutation` checks the whole command string, heredoc bodies included. Tested against the real function:

- `cat > …/20-steps.md <<'EOF' … Run \`jj log\` to see. … EOF`→ **blocked**. The plan document's text mentions jj commands, and`SUBSTITUTED_COMMAND`or`_segment_mutates_vcs` matches inside the heredoc body.
- `cat > …/10-architecture.md <<'EOF'\nbody mentions git commit and jj new\nEOF` → **blocked**.
- `echo "the untitled and \`git\` URIs"` → **blocked**. The backtick is treated as a command substitution next to a VCS name.
- Plain heredocs without VCS words, `rg -n git src` and `jj log` pass.

**Consequences:**

- The architect and planner agents couldn't save their documents. They wrapped the document in a "save this text as …" or "paste it over the draft" note instead. The driver saved that wrapped text as the plan file, so I had to strip the wrapper from:
  - `10-architecture.md`, twice;
  - `20-steps.md`;
  - five card files.
- Planner runs `20261009T071005-ed5e0a` and `-de85c5` used much of their time on these refusals.

**Fix needed in the harness (not applied).** Pick one:

- strip heredoc bodies and quoted text before running the VCS checks;
- or give the `architect` and `planner` roles a write tool scoped to `<plans>/<topic>/`, since the driver already saves their answer.

## 4. Card planning failures (structure rules, one bug)

| Run                                  | Failure                                                     | Cause                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261009T071005-ed5e0a` (tool-env)  | `A10: size L; split the card; A11: size L; …`               | `phased_cards.py:150` rejects size L. The planner wrote L cards anyway.                                                                                                                                                                                                                       |
| same                                 | `A11: depends on unknown card A12`                          | A12 was in `31-opened-file-projects.md`, but that file was written in the same pass. `verify.cards` reads sibling files from disk, and the sibling was still being written, so the dependency check couldn't see it. A real ordering bug: phases planned together can't see each other's ids. |
| `20261009T071005-de85c5` (toolchain) | `P3.a: src/**/*.ts is a glob`                               | Card `files` can't contain globs.                                                                                                                                                                                                                                                             |
| same                                 | `P7.R1: step P7 says description '…'; the target has '…'`   | `_target_mismatch` requires each card's `target.description` to equal its step's `place:` description exactly. The planner put each revision's own subject there.                                                                                                                             |
| `20261009T120259-63411d` (toolchain) | `steps: the front matter needs phases: as a non-empty list` | Restarting at `start=plan` makes the planner re-plan the steps when main has moved (#317 → #318). It rewrote `20-steps.md`, kept the old copy as `20-steps.prev.md`, and its rewrite failed the front-matter check. I restored the approved copy.                                             |

## 5. Implement started from a stale base (my error, fixed)

**What happened.** Run `20261009T110741-a88382` started cards A4.a, A10.a and A9a.a from `@-`. The scheduler resolves `@-` against the `repo` workspace, and ws-a's working copy was on `tormwpmo`: the A1 revision from before its merge, without A2 or A3 (#313–#318).

**Fix applied.** I cancelled that run, moved ws-a and ws-b onto `main@origin`, and restarted implement as run `20261009T115704-2a8357`.

## 6. Cancelled cards never retried (harness bug, worked around)

**What happened.** After the restart, A4.a and A10.a stayed `failed`, and 17 dependent cards stayed `blocked`.

**Why.** On resume, `phased_sched.py` around line 306 retries a `failed` card only if `state.failures[card_id] > 0`. Cancelling the earlier run marked those cards `failed` without counting a failure (`failures` holds only `plan-smoke` and `A9a.a`), so they're never relaunched.

**Workaround.** Set the cards back to `pending` in `state.json` and restart implement.

## 7. A9a.a hitting max rounds (a real review finding, not infrastructure)

**What happened.** Run `20261009T115704-84e3f1` ran three rounds: `check_passed: true`, then 3, 5 and 3 must-fix findings.

**Open findings:**

- `INTERACTIVE_ROLES` lacks `spinbutton`, so the lineage "Default expansion" number input is never counted.
- Controls that share an accessible name ("Close", "Open file") collapse into one `ControlId`, which hides missing tests.
- The card added `src/test/lineageHarness.tsx`, which isn't in its file list.

**Fix applied.** The run asked whether to switch models, and I chose `work:high`. It is retrying as run `20261009T124825-beee15`.

## 8. The user's `strands-spike` workspace was forgotten (harness bug)

**What happened.** The implement restart logged "removed stray workspace strands-spike".

**Why.**

- `phased_stack.py:112` `strays()` treats every workspace whose name starts with `strands-` as the harness's own.
- `remove_workspace` (`worktree.py:215`) then forgot it.
- It deletes only `<repo parent>/.<name>`, so the folder `~/projects/fpu-strands-spike` survived. Its working-copy registration was lost, and `jj workspace update-stale` there reports "Nothing checked out".

**What it held.** Revision `kwkurozm`: an `isPreviewUri()` helper in `src/projects/previewUri.ts`, plus a test. Nothing on main uses it. It is saved as `/tmp/fpu-strands-spike-kwkurozm.patch` and the revision was abandoned. The folder (1.5 GB) is now just a stale checkout and can be deleted.

**Fix needed in the harness.** Count a workspace as stray only if the run state recorded it, or if its folder is `.<name>` beside the repo.
