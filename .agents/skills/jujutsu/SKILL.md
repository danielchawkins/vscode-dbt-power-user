---
name: jujutsu
description: Use Jujutsu (jj) for version-control work in repositories containing `.jj/`, or when adopting, configuring, or troubleshooting jj. Covers colocated Git interoperability, changes, bookmarks, rewriting, recovery, GitHub pushes, and parallel agent workspaces. Do not use for an ordinary Git repository unless the user explicitly asks about jj.
---

# Jujutsu

Use jj for local version-control mutations while preserving Git remotes and GitHub interoperability. In a colocated repository, keep mutating Git commands exceptional because jj and Git share files and refs but use different working-copy models.

## Procedure

1. Detect the repository before changing state:

   ```bash
   test -d .jj && jj root
   ```

   If `.jj/` is absent, continue with Git unless the user explicitly asked to adopt jj. Do not initialize jj without approval; the first jj command snapshots every unignored working-copy change.

2. Inspect with `jj status`, `jj log`, and `jj diff`. The working-copy commit is `@`; there is no staging area. New unignored files are tracked when jj snapshots the working copy.

3. Use jj for mutations:

   - `jj describe -m "message"` updates the current change.
   - `jj new` preserves the current change and starts another.
   - `jj commit -m "message"` describes the current change and starts an empty one.
   - `jj split`, `jj squash`, and `jj rebase` reorganize mutable changes.
   - `jj undo` reverses the latest operation; inspect `jj op log` before broader recovery.

4. Create or move a bookmark only when a Git branch name is needed. Bookmarks follow rewritten changes but do not advance merely because a new child commit was created.

5. Before pushing, run the repository's required checks. jj does not execute Git hooks. If the repository documents a push wrapper, use that instead of raw `jj git push`. Use `--dry-run` when the bookmark or remote selection is not obvious.

6. After a mutation or push, verify `jj status`, `jj log`, and the relevant bookmark. Use `gh` for pull requests and GitHub state.

Done when the intended changes and bookmarks are visible in `jj log`, required checks pass, and the remote state is verified after a push.

## Gotchas

- `jj status` snapshots the working copy; it is observational but not operation-free.
- `jj abandon` discards a revision's changes and rebases descendants. It is not a stash command.
- `jj restore` discards selected content while keeping the change; inspect the diff first.
- Conflicts can live in commits. Resolve them before pushing; `jj git push --allow-conflicts` is the explicit override.
- Colocated jj automatically imports and exports Git refs. Do not interleave `git commit`, `git rebase`, `git branch -f`, or `git checkout -b`; Git-side rewrites can abandon jj changes or conflict bookmarks.
- Git's staging area and hooks are not supported by jj. A successful `jj git push` does not prove local checks ran.
- Use change IDs for revisions that may be rewritten; commit IDs change after rewrites.
- `stack()`, `substack()`, `jj sb`, `jj top`, and `jj bottom` seen in examples are user-defined aliases, not jj builtins.

## References

- `references/commands.md` — read before an unfamiliar mutation, bookmark operation, conflict resolution, or recovery.
- `references/workflows.md` — read when adopting jj, preparing a GitHub PR, interrupting work, rewriting a stack, or creating parallel agent workspaces.
- `references/revsets.md` — read when selecting more than the current change or a named bookmark.
