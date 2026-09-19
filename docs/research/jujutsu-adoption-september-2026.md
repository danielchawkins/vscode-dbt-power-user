# Jujutsu adoption, September 2026

## Recommendation

Adopt Jujutsu incrementally as a colocated, local interface over the existing Git repository. Keep GitHub, Git remotes, CI, and Git-only contributor support unchanged. Vendor accurate agent guidance, resolve jj through mise with a committed lock, and use an explicit checked push path.

This repository is a good candidate because the refactor is already organized as small, ordered commits, and jj makes it cheap to edit, split, reorder, and rebase mutable changes. Colocation preserves compatibility with VS Code, GitHub CLI, Git-based CI, and tools that require `.git/`. Official documentation says a colocated workspace shares one working copy and automatically imports and exports Git refs on every jj command.[^1]

The migration should not happen in the current dirty working tree. Most jj commands snapshot every unignored file into the working-copy commit, so initializing now would make the Markdown migration and Jujutsu adoption one change.[^2]

## The integration gap

Jujutsu does not support Git hooks.[^3] Therefore `jj git push` will bypass the Lefthook pre-push command that currently enforces `just check`. Jujutsu's own push safety checks protect bookmark state, not repository quality gates.[^4]

Do not describe jj as adopted until the repository has a checked push path. The implementation is `just jj`, which forwards its arguments to jj unchanged and prepends `just check` to `git push`. One entry point beats a separate push recipe: contributors and agents learn `just jj` instead of remembering which jj subcommands are gated. CI remains the authoritative remote backstop.

## Phased implementation

### 1. Guidance — included in this change

Vendor a generic `.agents/skills/jujutsu/` with a narrow `.jj/` trigger, current 0.45.1 commands, and conditional references for commands, workflows, and revsets. Put this repository's Lefthook/`just check` push rule in `AGENTS.md`, not in the skill. The skill combines Onevcat's stronger routing and agent-workspace patterns with a corrected, compressed subset of the CryFS references; it does not copy either source verbatim.

### 2. Tool and gate — included in this change

1. Configure `"aqua:jj-vcs/jj" = "latest"` in `mise.toml`; `mise.lock` currently resolves jj 0.45.1.
2. Use `just jj` as the only jj entry point; it gates `git push` on `just check` and passes everything else through.
3. Verify the gate against a disposable bookmark after `.jj/` exists.

The committed lock avoids silently changing CLI semantics in a workflow skill. jj 0.45.1 was published on 2026-09-03, and mise's Aqua backend resolves it on this machine.[^5]

### 3. Local initialization — run by `just setup`

`scripts/workspace/setup/configure-jujutsu.sh` initializes colocated mode, copies the Git identity, pins the push remote and `trunk()`, and tracks `master`. It skips when `.jj/` already exists, so `just setup` stays idempotent; `--force` reapplies the configuration.

Colocation is the current default, but keeping `--colocate` makes the intended interoperability explicit. The fork's `master@origin` is the immutable trunk; fetch `upstream` only when you need Altimate's refs, with `jj git fetch --remote upstream`. Do not put `upstream` in `git.fetch`.

Verify:

```bash
just jj status
just jj log
just jj git colocation status
git status
```

Do not commit `.jj/` or repository-level jj configuration. A Git-only checkout remains valid.

### 4. Trial period

Use jj for one refactor phase before changing more repository policy. During the trial:

- use `just jj` for local mutations and read-only Git commands only;
- never call jj directly, so the push gate cannot be skipped;
- use bookmarks only for GitHub branch names;
- use `jj workspace add` for concurrent agents instead of Git worktrees;
- record any Cursor, GitHub CLI, or background-fetch conflict; and
- keep CI and GitHub branch protection unchanged.

After the trial, decide whether jj remains optional contributor tooling or becomes the repository's documented default.

## Source assessment

The CryFS skill is the better factual starting point because it separates commands, revsets, and workflows and comes from a project actively using jj.[^6] It is not safe to copy unchanged: its bookmark-move examples use `-r` where jj 0.45.1 uses `--to`, and it omits the Git-hook incompatibility that matters here. Its `--named` push form is valid in 0.45.1; `--allow-new` is not.

The Onevcat skill has the better trigger: use jj when `.jj/` exists or the user explicitly requests it, not for every Git operation in every repository.[^7] Its parallel-workspace and interruption patterns are useful. Its safety wording is too broad, and its claim that `jj abandon` absorbs changes into the parent is incorrect for jj 0.45.1; abandonment discards that revision's diff and rebases descendants.[^8]

The in-repo skill therefore keeps Onevcat's routing idea, CryFS's reference split, and only commands verified against current official documentation or the 0.45.1 CLI.

## Evidence limits

The official documentation confirms the data model and commands but does not establish that Cursor's built-in Git UI behaves cleanly with every colocated jj state. Colocated mode can also produce confusing refs when background Git operations interleave with jj, and Git tools do not represent conflicted jj commits well.[^1] The trial period is necessary evidence, not rollout ceremony.

## Sources

[^1]: [Git compatibility](https://jj-vcs.github.io/jj/latest/git-compatibility/): colocated workspaces share a working copy, synchronize on every jj command, and have documented interleaving caveats.

[^2]: [Working copy](https://jj-vcs.github.io/jj/latest/working-copy/): “Most `jj` commands you run will commit the working-copy changes if they have changed.”

[^3]: [Git compatibility — supported features](https://jj-vcs.github.io/jj/latest/git-compatibility/#supported-features): “Hooks: No.”

[^4]: [Bookmarks — pushing safety checks](https://jj-vcs.github.io/jj/latest/bookmarks/#pushing-bookmarks-safety-checks): jj compares the remote bookmark with its last-seen state and refuses conflicted updates.

[^5]: [jj 0.45.1 release](https://github.com/jj-vcs/jj/releases/tag/v0.45.1), published 2026-09-03; local `mise ls-remote jj` and `mise x jj@0.45.1 -- jj --version` verification on 2026-09-19.

[^6]: [CryFS Jujutsu skill](https://github.com/cryfs/cryfs/tree/d936715525b43eae66708277567ede0bf5ae6531/.claude/skills/jujutsu), inspected at commit `d936715525b43eae66708277567ede0bf5ae6531`.

[^7]: [Onevcat Jujutsu skill](https://github.com/onevcat/skills/blob/4955f5422d992db58ddb3652ec1c1b552405b39d/skills/onevcat-jj/SKILL.md), inspected at commit `4955f5422d992db58ddb3652ec1c1b552405b39d`.

[^8]: [CLI reference — `jj abandon`](https://jj-vcs.github.io/jj/latest/cli-reference/#jj-abandon): abandonment rebases descendants onto the revision's parents; abandoning `@` creates a new empty working-copy commit.
