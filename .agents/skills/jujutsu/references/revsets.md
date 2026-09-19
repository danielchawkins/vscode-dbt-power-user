# Jujutsu revsets

Revsets select revisions for `jj log -r` and mutation commands. Test a nontrivial expression with `jj log -r '<expression>'` before passing it to a rewriting command.

## Core selectors

| Expression | Selection                                 |
| ---------- | ----------------------------------------- |
| `@`        | Current working-copy commit               |
| `@-`       | Parent of the working-copy commit         |
| `@--`      | First grandparent                         |
| `x+`       | Children of `x`                           |
| `::x`      | Ancestors of `x`, inclusive               |
| `x::`      | Descendants of `x`, inclusive             |
| `x::y`     | DAG range from `x` through `y`, inclusive |
| `x..y`     | Revisions reachable from `y` but not `x`  |
| `x \| y`   | Union                                     |
| `x & y`    | Intersection                              |
| `x ~ y`    | Difference                                |
| `~x`       | Complement                                |

Use parentheses when combining ancestry and set operators. Use change IDs for mutable work because they remain stable across rewrites.

## Useful functions

| Expression                   | Selection                                     |
| ---------------------------- | --------------------------------------------- |
| `trunk()`                    | Configured mainline revision                  |
| `mutable()`                  | Revisions jj permits rewriting                |
| `immutable()`                | Trunk, tags, and other protected history      |
| `mine()`                     | Revisions authored by the configured user     |
| `bookmarks()`                | Local bookmark targets                        |
| `remote_bookmarks()`         | Remote bookmark targets                       |
| `tracked_remote_bookmarks()` | Tracked remote bookmark targets               |
| `conflicts()`                | Revisions containing file conflicts           |
| `divergent()`                | Revisions sharing a change ID                 |
| `empty()`                    | Revisions with no diff                        |
| `description(pattern)`       | Descriptions matching a string pattern        |
| `files(expression)`          | Revisions touching matching paths             |
| `reachable(source, domain)`  | Connected revisions reachable within a domain |
| `ancestors(x, depth)`        | Ancestors limited to a depth                  |
| `descendants(x, depth)`      | Descendants limited to a depth                |

String patterns support prefixes such as `exact:`, `glob:`, and `regex:`. Quote the complete revset in the shell.

## Practical queries

```bash
# Current mutable stack
jj log -r 'reachable(@, mutable())'

# Work in the current ancestry that is not on any remote
jj log -r 'remote_bookmarks()..@'

# Work not yet on origin
jj log -r 'remote_bookmarks(remote=origin)..@'

# Mutable work authored by the configured user
jj log -r 'mutable() & mine()'

# Conflicted or divergent work
jj log -r 'conflicts() | divergent()'

# Recent context around the working copy
jj log -r 'ancestors(@, 5)'

# Changes touching a path
jj log -r 'files("src")'
```

## Rewriting selections

Inspect first, then reuse the same expression:

```bash
jj log -r 'roots(trunk()..@)'
jj rebase --source 'roots(trunk()..@)' --destination 'trunk()'
```

Prefer one change ID over a broad revset when only one revision should move. Do not pass `all()`, `visible()`, or an unbounded descendant set to a mutation unless the user explicitly intends a repository-wide rewrite.

## Official reference

<https://docs.jj-vcs.dev/v0.45.0/revsets/>
