# Jujutsu workflows

## Adopt jj in a Git repository

Adopt jj after the Git working tree is clean. Initialization snapshots all unignored changes into `@`; starting clean makes the imported history and current work unambiguous.

1. Install a current jj and verify `jj --version`.
2. Remember that `jj git push` does not execute Git hooks; keep using the repository's existing check command before push.
3. Initialize colocated mode:

   ```bash
   jj git init --colocate .
   ```

   Colocation is the current default, but the explicit flag records the intended Git interoperability.
4. Copy Git identity and set remotes and trunk to match this clone. Use the actual default-branch bookmark (`main`, `master`, or another name) and include extra fetch remotes only when they exist:

   ```bash
   jj config set --repo user.name "$(git config user.name)"
   jj config set --repo user.email "$(git config user.email)"
   jj config set --repo git.push origin
   jj config set --repo 'revset-aliases."trunk()"' 'main@origin'
   ```

   Extra remotes belong in `git.fetch` only when they exist.
5. Inspect imported bookmarks and track only those that should move with their remote:

   ```bash
   jj bookmark list --all-remotes
   jj bookmark track main --remote origin
   ```

6. Verify `jj status`, `jj log`, `jj git colocation status`, `git status`, and a push dry-run. Do not add `.jj/` to the repository; jj keeps its own metadata ignored inside that directory.

Git-only contributors can keep using Git. `.jj/` and repository-level jj configuration stay local to each workspace.

## Daily change

```bash
jj new 'trunk()'
# edit files
jj diff
# run the repository's required checks
jj commit -m "feat: describe the change"
```

`jj commit` leaves an empty working-copy commit on top. The completed change is then `@-`.

For a small change, edit the current empty `@`, run checks, and use `jj commit -m "message"`. For a larger change, create several described changes and use `jj split`, `jj squash`, or `jj absorb` after the implementation reveals the right boundaries.

## Interrupt and resume

Do not stash. Preserve the current change, start urgent work from trunk, then return by change ID:

```bash
jj describe -m "wip: original task"
jj new 'trunk()'
# complete urgent work
jj commit -m "fix: urgent issue"
jj edit <original-change-id>
```

Use a temporary WIP description only while the change remains local; replace it before pushing.

## Push a GitHub branch

Generated bookmark names are shortest for disposable branches:

```bash
# run the repository's required checks
jj git push --dry-run --change @-
jj git push --change @-
```

Use a named bookmark when a stable GitHub branch name matters:

```bash
jj bookmark create feature-name --revision @-
# run the repository's required checks
jj git push --dry-run --bookmark feature-name --remote origin
jj git push --bookmark feature-name --remote origin
gh pr create --head feature-name
```

Or name and push in one step with `jj git push --named feature-name=@- --remote origin`. For an existing bookmark, move it to the intended change and push:

```bash
jj bookmark move feature-name --to @-
# run the repository's required checks
jj git push --bookmark feature-name --remote origin
```

After every push, verify the bookmark with `jj bookmark list feature-name --all-remotes` and inspect the GitHub branch or pull request with `gh`.

## Stack dependent GitHub PRs

A local commit stack needs no bookmarks. GitHub compares branches, so dependent PRs need one bookmark per review layer:

```bash
jj bookmark create part-1 --revision <lower-change>
jj bookmark create part-2 --revision <upper-change>
# run the repository's required checks
jj git push --bookmark part-1 --bookmark part-2 --remote origin
gh pr create --head part-1 --base main
gh pr create --head part-2 --base part-1
```

Rewrite and rebase the changes with jj; descendant changes and their bookmarks follow automatically. Push rewritten bookmarks with jj before updating GitHub.

If GitHub stacked pull requests are available, `gh stack link --base main --open part-1 part-2` can link branches already pushed by jj. In a colocated repository, do not use `gh stack init`, `add`, `rebase`, `sync`, `push`, or `checkout`: they mutate Git history or refs outside jj and maintain separate stack state.

Treat a published PR stack as append-only. Reordering or inserting a middle layer can make GitHub mark a PR merged or invalidate its base. Merge bottom-up through GitHub's stack UI or `gh stack merge`; avoid `gh pr merge --delete-branch`, which can close dependent PRs instead of retargeting them.

## Address review feedback

Add a follow-up change when history should remain append-only:

```bash
jj new feature-name
# edit and verify
jj commit -m "fix: address review feedback"
jj bookmark move feature-name --to @-
# run the repository's required checks
jj git push --bookmark feature-name --remote origin
```

Rewrite a mutable change when clean commits are required:

```bash
jj new <target-change-id>
# edit and verify
jj squash
# run the repository's required checks
jj git push --bookmark feature-name --remote origin
```

Bookmarks follow rewritten changes, so the second workflow usually needs no manual bookmark move. Inspect `jj log` before pushing.

## Continue after merge

Fetch the merged result, then rebase remaining work and drop changes emptied by a squash merge:

```bash
jj git fetch
jj rebase --branch <remaining-head> --onto 'trunk()' --skip-emptied
jj bookmark list --all-remotes
```

Forget a stale local bookmark only after confirming its PR is merged and its remote bookmark is gone.

## Parallel agent workspaces

Use jj workspaces instead of Git worktrees:

```bash
jj workspace add ../task-name --revision 'trunk()' -m "task: isolated agent work"
cd ../task-name
```

Each workspace has its own `@` and shares commits and operations. Give concurrent agents separate workspaces; do not let them edit one working copy. When a workspace is no longer needed, run `jj workspace forget <name>` and remove its directory separately.

## Recover from a mistake

For the latest jj operation:

```bash
jj undo
jj status
```

For older or ambiguous history, inspect before changing state:

```bash
jj op log
jj op show <operation-id>
jj op diff --from <operation-id> --to @
```

Use `jj op revert` to reverse a selected operation while retaining later work. Reserve `jj op restore` for intentionally restoring the entire repository view to an earlier operation.

## Official references

- <https://docs.jj-vcs.dev/latest/github/>
- <https://docs.jj-vcs.dev/latest/git-compatibility/>
- <https://docs.jj-vcs.dev/latest/working-copy/>
- <https://docs.jj-vcs.dev/latest/operation-log/>
- <https://docs.github.com/en/pull-requests/reference/use-other-tools-with-stacked-pull-requests>
