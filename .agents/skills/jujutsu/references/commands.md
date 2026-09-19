# Jujutsu command reference

This reference targets jj 0.45.1. Run `jj help <command>` before relying on syntax not listed here.

## Inspect

| Goal                     | Command                   |
| ------------------------ | ------------------------- |
| Repository status        | `jj status`               |
| Current diff             | `jj diff`                 |
| One revision             | `jj show <revision>`      |
| Change graph             | `jj log`                  |
| Operation history        | `jj op log`               |
| Evolution of a change    | `jj evolog -r <revision>` |
| Tracked files            | `jj file list`            |
| File history attribution | `jj file annotate <path>` |

Most jj commands snapshot the working copy before doing anything else. Add `--ignore-working-copy` only when a stale view is intentional, such as a prompt or monitoring command.

## Create and edit changes

| Goal                                    | Command                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| Describe current change                 | `jj describe -m "message"`                               |
| Start a child change                    | `jj new`                                                 |
| Start from a revision                   | `jj new <revision>`                                      |
| Finish current change and start another | `jj commit -m "message"`                                 |
| Edit an existing mutable change         | `jj edit <change-id>`                                    |
| Split a change interactively            | `jj split`                                               |
| Move current diff into its parent       | `jj squash`                                              |
| Move selected content into the parent   | `jj squash --interactive`                                |
| Distribute edits to matching ancestors  | `jj absorb`                                              |
| Rebase current branch                   | `jj rebase --destination <revision>`                     |
| Rebase a change and descendants         | `jj rebase --source <revision> --destination <revision>` |

`jj commit` is a convenience for describing `@` and creating a new empty working-copy commit. It does not publish anything.

## Bookmarks and Git remotes

| Goal                                  | Command                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| List local and remote bookmarks       | `jj bookmark list --all-remotes`                            |
| Create bookmark                       | `jj bookmark create <name> --revision <revision>`           |
| Move bookmark forward                 | `jj bookmark move <name> --to <revision>`                   |
| Move bookmark backward or sideways    | `jj bookmark move <name> --to <revision> --allow-backwards` |
| Track remote bookmark                 | `jj bookmark track <name> --remote <remote>`                |
| Fetch                                 | `jj git fetch --remote <remote>`                            |
| Preview push                          | `jj git push --dry-run --bookmark <name> --remote <remote>` |
| Push bookmark                         | `jj git push --bookmark <name> --remote <remote>`           |
| Name and push a revision in one step  | `jj git push --named <name>=<revision> --remote <remote>`   |
| Generate a bookmark and push a change | `jj git push --change <revision> --remote <remote>`         |

Bookmarks map to Git branches, but there is no active bookmark. If `jj commit` leaves an empty `@`, the completed change is usually `@-`; place or move the bookmark there before pushing.

`jj git push` performs bookmark safety checks but does not run Git hooks. Run the repository's required checks first.

## Discard and recovery

| Goal                                  | Command                        |
| ------------------------------------- | ------------------------------ |
| Discard selected working-copy content | `jj restore <path>`            |
| Make current change empty             | `jj restore`                   |
| Abandon a revision                    | `jj abandon <revision>`        |
| Undo latest operation                 | `jj undo`                      |
| Redo latest undone operation          | `jj redo`                      |
| Inspect operation                     | `jj op show <operation-id>`    |
| Revert an earlier operation           | `jj op revert <operation-id>`  |
| Restore complete repository state     | `jj op restore <operation-id>` |

`jj abandon` drops the revision's diff and rebases descendants onto its parents. Use `jj new` to interrupt work without discarding it. Use `jj op log` before recovering anything older than the latest operation.

## Conflicts

| Goal                               | Command                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| List conflicts                     | `jj resolve --list`                                      |
| Resolve with configured merge tool | `jj resolve`                                             |
| Inspect conflicted change          | `jj show <revision>`                                     |
| Resolve in a child change          | `jj new <conflicted-revision>` then edit and `jj squash` |

Jujutsu records conflicts in commits, so a rebase can complete with unresolved conflicts. Resolve them before pushing; Git tools may display conflicted jj commits poorly in a colocated repository.

## Official references

- <https://docs.jj-vcs.dev/v0.45.0/cli-reference/>
- <https://docs.jj-vcs.dev/latest/git-command-table>
- <https://docs.jj-vcs.dev/latest/bookmarks>
- <https://docs.jj-vcs.dev/latest/operation-log/>
