# Rearchitecture plan reviews

Three independent read-only reviews shaped [`rearchitecture-plan.md`](rearchitecture-plan.md). Each round read the plan, the audits, and the code. This file records what each round found and what changed, so a later reader can see why the plan says what it says.

## Round 1 — model and ordering

| Finding                                                                                                                               | Change                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Nothing prevents a cloned workspace from choosing the executable the extension runs.                                                  | R2 adds workspace trust.                                                                                                           |
| Project Context, a proposed Invocation Context, and `ProjectPaths` were three concepts for one fact.                                  | One **Project Snapshot** per Declared Project holds paths and invocation; Project Context becomes **Current Project**, a selector. |
| R2 would wire the new context into the class stack R3 deletes.                                                                        | R3 builds `FusionCli` and the snapshot mappers in the same phase; R2 only adds settings and the pure snapshot type.                |
| 26 configuration reads in 12 files, several without a resource scope; the proposed lint rule targeted a directory that did not exist. | One `src/settings/` module, with a repository-wide lint rule and a baseline.                                                       |
| The open-time language switch had no exit.                                                                                            | R5 deletes it; non-standard layouts use the associations command.                                                                  |
| `DBTProjectContainer` is 29 forwarding methods.                                                                                       | R3 merges it into the Project Registry; exit `grep findDBTProject` = 0.                                                            |
| `workspaceContains:**/dbt_project.yml` scans recursively, against ADR 0003.                                                           | R4 removes the activation event.                                                                                                   |
| Redux Toolkit, `react-copy-to-clipboard`, form libraries, SCSS, test-cli, and one output channel were not planned.                    | Added to R1, R5, R6 and R7.                                                                                                        |

## Round 2 — seams the model left open

| Finding                                                                                       | Change                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The manifest had no home; four features keep private copies.                                  | `Project.manifest` with `onDidChangeManifest`; exit `grep eventMap` = 0.                                                                      |
| Two change streams without a rule.                                                            | Only `projects/` subscribes to project-scoped settings; features subscribe to `Project`; non-project settings are read through typed readers. |
| Per-command overrides were untyped; defer and `additionalParams` were resolved at call sites. | A closed override type; defer and command params live in the snapshot.                                                                        |
| The documentation editor overwrites user files with `fs`, bypassing unsaved buffers and undo. | A rule: user files change only through `WorkspaceEdit`, enforced by lint.                                                                     |
| dbt commands run through a custom terminal.                                                   | R5 adds a `TaskProvider` with `CustomExecution`.                                                                                              |
| Watchers may duplicate what Fusion registers with the client.                                 | Evidence task decides between deleting them and the client's `synchronize.fileEvents`.                                                        |
| Vitest migration and TypeScript 7 were early and costly.                                      | Vitest moves to R4's last PR; the TypeScript 7 check is not planned until typescript-eslint supports it; React 19 follows 1.0.0.              |
| Several steps had no exit.                                                                    | Named files, line limits, and decision rules for each evidence task.                                                                          |

## Round 3 — contradictions and residual special cases

| Finding                                                                                            | Change                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Trust was two models: restricted settings plus "start no process".                                 | `untrustedWorkspaces: { supported: false }`; VS Code enables the extension on grant; no trust code.                                    |
| Process spawns were checked by grep.                                                               | One module may import `child_process`, enforced by lint.                                                                               |
| `profiles.yml` parsing would reimplement dbt's `env_var` Jinja, and its target list has no caller. | Not parsed. Target is the setting or dbt's default; the adapter comes from the manifest; the parsing and `getTargetNames` are deleted. |
| Evidence tasks could invalidate code written earlier in R3.                                        | They run first, as R3.0.                                                                                                               |
| The critical `maplibre-gl` advisory could ship in 1.0.0 if R7 slips.                               | The `overrides` pin moves to R1.                                                                                                       |
| Exits relied on "recorded in the PR".                                                              | Each has a count or a threshold (≤ 3 modules on the call chain; activation and bundle within 10% of `v0.4.0-beta.1`).                  |
| Vocabulary changes were scheduled before the renames.                                              | `CONTEXT.md` changes land with the renames in R3.5.                                                                                    |
