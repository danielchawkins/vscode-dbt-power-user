# finance-pipelines integration

This document defines how [`Kikoff/finance-pipelines`](https://github.com/Kikoff/finance-pipelines) will consume Fusion Power User. It is not an extension architecture dependency: another Consumer Repository can use a different task runner, tool manager, or workspace layout.

## Relevant consumer architecture

finance-pipelines is a uv workspace with:

- dbt Fusion installed and pinned through root `mise.toml` and `mise.lock`;
- repository tasks exposed through a root `justfile` and project modules;
- first-run and update orchestration under `scripts/workspace/setup/`;
- Git hooks managed by Lefthook;
- a committed multi-root `finance-pipelines.code-workspace`;
- `finance_general` and `finance_sox` as separate workspace folders;
- local packages in a separate workspace folder;
- editor configuration split between window settings and folder-scoped `.vscode/settings.json`; and
- Cursor and VS Code extension recommendations.

The repository currently works around Power User and SQLFluff limitations with:

- a script that patches the installed Power User JavaScript bundle;
- folder-open tasks that reapply that patch;
- a dbt-core-interface server per dbt project for SQLFluff diagnostics;
- fixed SQLFluff ports and multi-root settings;
- Power User allow-list and activation workarounds; and
- explicit formatter selection to resolve competing SQL providers.

Fusion Power User should make those workarounds removable, but the consumer must delete them only after acceptance tests prove parity.

## Installation contract

Add one self-contained setup installer under `scripts/workspace/setup/`. It receives the pinned release version and checksum from committed configuration.

The installer:

1. checks whether Cursor and VS Code CLIs exist;
2. checks the installed `danielchawkins.fusion-power-user` version in each editor;
3. exits without network access when both present editors already have the pinned version;
4. downloads the VSIX from the fork's GitHub Release;
5. verifies its checksum before installation;
6. uninstalls `innoverio.vscode-dbt-power-user` from each present editor;
7. installs the VSIX into each present editor; and
8. supports the setup system's existing `--force` behavior.

Use the editor CLIs for installation. Do not copy the VSIX into the repository.

## mise-vscode integration

Fusion Power User remains tool-manager-neutral. finance-pipelines configures its executable with mise-vscode.

Add `danielchawkins.fusion-power-user` to `mise.customBinaryExtensions`:

- tool source: `aqua:getdbt.com/dbt-fusion`;
- binary: `dbt`;
- target setting: the final executable-path key under `fusionPowerUser.*`;
- use shims and project-relative symlinks; and
- exclude global tools so only the repository's `mise.toml` participates.

After the setting contract is stable, propose built-in support to mise-vscode. Keep the custom mapping until a released mise-vscode version contains and tests that support.

## Project configuration

The multi-root workspace should produce two Declared Projects:

- `finance_general`
- `finance_sox`

Each dbt workspace folder contains `dbt_project.yml`, so root auto-activation should be sufficient. Folder settings may explicitly declare `"."` if the repository wants configuration to remain obvious.

The `local_packages` workspace folder is not itself a Declared Project. dbt parses installed package copies as dependencies of each project. Editing a package receives no project service unless its own folder contains `dbt_project.yml` and is explicitly declared.

Project-specific profiles, targets, and environment-file overrides belong in folder-scoped settings. Window settings must not select the first project as a fallback.

## Extension recommendations

Recommend:

- `danielchawkins.fusion-power-user`;
- `hverlin.mise-vscode`;
- the existing Python, Ruff, YAML, Just, Markdown, and formatting extensions that remain relevant to the repository.

Remove:

- `innoverio.vscode-dbt-power-user`;
- its transitive Altimate MCP and Jinja recommendations unless another feature still requires them; and
- `sqlfluff.vscode-sqlfluff` after native LSP lint and formatting pass acceptance.

Mark the upstream Power User extension as unwanted if the editor recommendation format supports it.

## Parity gate before deleting workarounds

Exercise both projects in Cursor and VS Code:

- startup and project-context selection;
- completion, hover, definitions, references, rename, and semantic tokens;
- YAML behavior alongside the Red Hat YAML extension;
- lint diagnostics and fix-all;
- formatting through the normal editor formatter API;
- compile and compiled SQL;
- query and CTE preview;
- run, build, test, and selector variants;
- model and column lineage;
- local documentation editing;
- package references and cross-project references;
- dependency parse failures without dependency lint noise; and
- reload, workspace-folder add/remove, process crash, and extension upgrade.

Only then remove:

- `scripts/patch_dbt_power_user_macro_hover.py`;
- the `power-user-patch` folder-open tasks;
- `transformation/dbt/resources/scripts/sqlfluff_server.py`;
- SQLFluff server tasks and fixed ports;
- dbt-core-interface dependencies used only by editor diagnostics;
- Power User-specific allow-list, activation, polling, API, notebook, and AI settings; and
- SQLFluff extension settings and recommendations.

Keep CLI lint and format behavior unchanged unless a separate repository decision changes it. Editor migration does not authorize changing CI or pre-commit semantics.

## Tooling reference, not a template

Before implementing the fork, compare its existing Node workflows with finance-pipelines conveniences:

- mise pinning and lockfiles;
- small public `just` recipes;
- shell logic in scripts rather than long recipes;
- idempotent setup installers;
- Lefthook's staged-file scoping;
- editor recommendations and multi-root workspace conventions;
- concise repository agent instructions; and
- vendored skills that materially help contributors.

Reuse a convention only when it removes setup friction or creates local/CI parity. Do not import uv, dbt project modules, Snowflake setup, Python linting, or finance-specific orchestration into a TypeScript extension repository.
