# Contributor tooling adoption

This is the first implementation decision for the fork. It compares Power User's existing Node workflows with the conveniences in finance-pipelines and defines what to reuse.

## Decision

Keep the extension Node-native:

- npm lockfiles install JavaScript dependencies;
- npm scripts remain the authoritative implementation of build, lint, test, and package operations;
- ESLint and Prettier continue to own TypeScript, JavaScript, JSON, CSS, and webview formatting;
- Jest and the existing VS Code test infrastructure remain the test frameworks; and
- Lefthook is the Git hook implementation, replacing Husky and lint-staged, because staged-file scoping reads more clearly in one declarative file.

Add a small contributor layer:

- `scripts/workspace/setup/setup-environment.sh` bootstraps mise and the mise-managed Just entry point;
- `mise.toml` and `mise.lock` pin one Node LTS plus contributor CLIs;
- one root `justfile` exposes `setup`, `fmt`, `lint`, `check`, `jj`, and `package`;
- dprint and rumdl own Markdown only;
- shfmt and ShellCheck own shell scripts;
- `AGENTS.md` becomes the concise canonical contributor and agent guide;
- `CLAUDE.md` and `.claude/` become compatibility symlinks to `AGENTS.md` and `.agents/`;
- `.vscode/extensions.json` and `.vscode/settings.json` recommend and configure the repository's actual tools;
- selected reusable skills live under `.agents/skills/`; and
- CI pins actions, uses the same Node version, runs the same checks, builds the VSIX, and emits a checksum.

This layer exists for contributor consistency. The shipped extension remains tool-manager-neutral and never invokes mise or Just.

## Adopt

### mise

Pin:

- the chosen Node LTS;
- Just;
- dprint;
- rumdl; and
- any existing native CLI already required by the extension build.

Pin dbt Fusion to the minimum supported version in this repository's `mise.toml`, so a failing integration test is attributable to the extension rather than to a Fusion upgrade. This is a development-environment decision only: the shipped extension resolves `dbt` from `PATH` or an explicit path setting, and neither it nor its tests may invoke mise.

Use a committed lockfile. CI consumes the same configuration through `jdx/mise-action` only if that is simpler than the existing Node setup; do not install Node twice.

### Just

Keep the root file short. Recipes dispatch npm scripts and repository scripts; they do not duplicate shell logic.

Required public contract:

```text
just setup
just fmt
just lint
just check
just jj
just package
```

The implementation agent must add or normalize one `npm run check` command so both Just and CI call one gate.

### Markdown

Use dprint for Markdown formatting and rumdl for structural linting. Keep one physical source line per prose paragraph, let the editor and renderer soft-wrap it, configure dprint to maintain authored wrapping, and disable rumdl's line-length rule. Remove Markdown from Prettier so one file type never has two formatters. Do not add `markdownlint-cli2` alongside rumdl; their structural rules overlap.

Scope copied legacy documentation separately. Either bring it into compliance in one mechanical commit or exclude it temporarily with a named removal condition. New root docs, `CONTEXT.md`, ADRs, and `docs/refactor/` must pass from the first tooling commit.

### Agent guidance and skills

Create `AGENTS.md` with:

- the product boundary and links to `CONTEXT.md`, ADRs, and `docs/refactor/`;
- the public Just commands;
- concise prose and comment rules;
- the test and release gates; and
- the rule that the extension is local, Fusion-only, and tool-manager-neutral.

Copy only skills the fork uses:

- `configure-mise`;
- `justfile-expert`;
- `jujutsu`; and
- `write-skill`.

Do not copy finance-pipelines skills for Dagster, Snowflake setup, Sigma, dbt project development, or stacked PRs unless the fork later adopts those workflows.

### Editor setup

Keep existing ESLint and Prettier recommendations. Add mise-vscode, dprint, rumdl, and Just syntax support. Configure dprint as the Markdown formatter. Do not copy finance-pipelines Python, Ruff, SQLFluff, dbt-project, or multi-root settings into the extension repository.

### CI and release

Unify the root and webview packages on one Node LTS before changing product code. Pin third-party actions and add timeouts and least-privilege permissions.

Every pull request runs:

- dependency install;
- compile/typecheck;
- lint;
- unit tests;
- extension-host integration tests where applicable; and
- VSIX packaging.

Prerelease tags publish the VSIX and SHA-256 checksum to GitHub Releases. Marketplace and Open VSX publishing are deferred until the independent identity and release process are stable.

## Keep from upstream

Retain and simplify rather than replace:

- `package.json` scripts;
- package lockfiles;
- ESLint and Prettier configuration;
- Jest configuration and mocks;
- rsbuild/Vite while retained extension and webview bundles require them.

## Do not adopt

Do not copy:

- uv, Python workspace configuration, or pytest;
- modular dbt/Dagster Just files;
- Snowflake, Sigma, Homebrew, or host bootstrap scripts;
- finance-pipelines' multi-root workspace;
- Ruff or SQLFluff editor settings;
- finance-specific CI deploy workflows; or
- setup and domain skills unrelated to extension development.

## Required first tooling commit sequence

1. Pin one Node LTS across root package, webview package, local setup, and CI.
2. Add the canonical npm `check` script without changing product behavior.
3. Add mise and the thin Just facade.
4. Add `AGENTS.md`, shorten `CLAUDE.md`, and copy the selected skills.
5. Split Markdown ownership from Prettier and add dprint/rumdl.
6. Update editor recommendations.
7. Harden CI and prove the unchanged upstream extension still builds, tests, and packages.

Product refactoring starts only after this baseline is green.

## Status

Complete. The branch is based on upstream 0.64.6. Root and webview dependencies install with `npm ci`; `just check` compiles, lints code and shell, checks formatting, validates both npm lockfiles, runs 637 unit tests, and checks Markdown; `just package` builds the VSIX. The macOS CI job uses the same commands, uploads the VSIX and checksum, and limits duplicate runs with a concurrency group. The next work is the Fusion version gate in Phase 1.2 of the refactor plan.
