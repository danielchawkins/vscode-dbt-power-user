---
name: write-skill
description: >-
  Write or revise an Agent Skill — SKILL.md frontmatter, progressive disclosure across references/, scripts/, and
  assets/, host portability, and testing that a skill triggers and helps. Use when creating a new skill, editing or
  shortening an existing SKILL.md, deciding whether guidance belongs in a skill or in AGENTS.md, or when a skill fails
  to trigger.
---

# Writing agent skills

A skill is on-demand procedure and reference. Persistent constraints that apply to nearly every task belong in
`AGENTS.md`; anything that must be enforced rather than encouraged belongs in a script, hook, or CI check. Reach for a
skill when the work is specialized, repeatable, and only sometimes relevant.

Copy `assets/skill-template.md` to start. Validate with `npx --yes skills-ref@0.1.5 validate <dir>`.

## Frontmatter

`name` and `description` are the only required fields, and the only ones every host reads. `name` is 1-64 characters of
lowercase letters, digits, and single interior hyphens, and must match the directory. `description` is capped at 1024
characters. Optional spec fields are `license`, `compatibility` (≤500), `metadata` (string to string), and
`allowed-tools` (experimental).

The description is the entire routing surface: at startup a host loads only name and description, roughly 100 tokens
per skill. Say what the skill does and when it applies, put the main case first, and use the words a caller would
actually type. Terms that belong to this skill and no other — a filename, a command, a product name — are what make
routing land.

Host-specific fields do not travel:

|                            | Claude Code               | Cursor | Codex                             |
| -------------------------- | ------------------------- | ------ | --------------------------------- |
| `.agents/skills/`          | via the `.claude` symlink | native | native                            |
| `disable-model-invocation` | yes                       | yes    | ignored, use `agents/openai.yaml` |
| `paths` / `icon` / `color` | ignored                   | yes    | ignored                           |

## Organize the skill

Everything in `SKILL.md` loads the moment the skill fires, so it holds only what every run needs: the procedure, the
decisions, and the gotchas that are not guessable. Keep it under 500 lines and 5000 tokens, usually far under. Detail
that only some runs need goes in `references/`, executable code in `scripts/`, and templates or lookup data in
`assets/`. Hex palettes, ordered lists, and other copy-paste tokens are assets; when to apply them is a reference.

One skill, one coherent job. Split only when the halves have genuinely distinct triggers; length alone is not a reason,
and two skills with overlapping descriptions compete for the same prompts and both route worse.

A pointer works only if it names the condition that fires it. "Read `references/x.md` when the rebase conflicts" works;
"see references for detail" does not, because the agent then loads everything or nothing. `gh-stack/SKILL.md` is the
in-repo example to copy.

Keep resources one level below `SKILL.md`, group each subject in one file, and avoid reference chains. Delete empty
directories and unused examples. If several skills share a fact, put it in the narrowest persistent project
documentation they can all read rather than copying it into each skill.

## Python scripts

Python scripts are self-executable uv scripts with PEP 723 metadata:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
```

Declare only direct dependencies, mark the file executable, and run it as `./scripts/<name>.py`. A script provides
`--help`, validates inputs before side effects, returns a nonzero status on failure, and keeps generated or secret data
outside the skill directory. Verify it from a clean environment so undeclared imports fail during development.

## Writing and revising

1. Watch the agent fail the task without a skill; that transcript tells you what to write.
2. Write the smallest body that fixes what you saw, then write the description.
3. Test routing and execution separately: does it fire on realistic prompts and stay quiet on near-misses, and does the
   run beat the no-skill baseline?
4. Delete anything that did not change behavior.

Before adding a line, ask whether the agent would get it wrong without it; when you cannot tell, run it both ways. End
a procedure on a condition the agent can check — "every changed model has a test" rather than "tests are adequate".
Explain why rather than stacking ALWAYS and NEVER, because models follow reasoning more reliably, and blanket "be
exhaustive" wording causes unnecessary exploration rather than better work. Give one default with a short escape hatch
instead of a menu. A check the code can make does not belong in prose.

Two failure modes are worth naming because both feel safe at the time. Duplication, the same rule in the body and in a
reference, doubles maintenance and inflates the rule's apparent weight. Stale lines accumulate because adding is easy
and deleting feels risky. Both are cured by deleting rather than rewriting.
