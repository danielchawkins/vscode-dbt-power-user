# Read each project's tool environment from mise or direnv, read-only

**Status:** Decided 2026-10-13.

## Context

A Declared Project often needs the `PATH` and variables that its own mise or direnv configuration defines, such as a pinned `dbt` version. The mise extension provides one environment per window, so it cannot give each project of a multi-root workspace its own environment. The user wants a project's declarations to shadow the global ones without per-machine settings. Reading `mise.toml` in the extension would re-implement mise, so the extension asks the tool manager for the result instead.

## Decision

**Per project, read-only (D1, D2).** Each Declared Project gets one resolved environment: the host environment, overlaid by the tool environment for its root. The executable lookup, the version probe, the language server launch and every CLI command of that project use it. The extension runs at most one tool manager per project, and only these read-only commands:

- `mise env --json -C <root>`, when `mise` is on the host `PATH`.
- `mise config ls --json -C <root>`, to decide whether the project has its own mise config.
- `direnv status --json` and `direnv export json`, run in the root, when `direnv` is on the host `PATH` and an `.envrc` exists at or above the root.

**mise first, direnv otherwise, never combined.** If `mise env` succeeds and `mise config ls` lists a file that is neither global nor system config, mise wins. Otherwise direnv is used when it is available and an `.envrc` exists at or above the root. Global-only mise config counts as no config only when choosing between mise and direnv. If direnv is not used, the global-only mise output still applies.

**Failures (D3).** If `mise env` reports untrusted or fails, that result stands and direnv is not tried. The tool manager runs with the project root as its working directory, stdin ignored, and a 5 s timeout.

**Trust and switches.** The extension never trusts, installs or allows. Nothing runs in an untrusted workspace, and `fusionPowerUser.toolEnvironment` (`auto` by default, or `off`) turns resolution off, so the project uses the host environment. An untrusted config gives one warning per project and hint, naming `mise trust <file>` or `direnv allow`, with a Show output action. Any other failure logs one line to the project's output channel.

**When it is resolved.** The environment is resolved again when `fusionPowerUser.toolEnvironment` changes, when workspace trust is granted, and when one of these watched files changes: `mise.toml`, `.mise.toml`, `mise.local.toml`, `.mise.local.toml`, `.tool-versions`, `.envrc` or `.config/mise/config.toml`.

**Executable resolution.** `fusionPowerUser.dbtPath` comes first. Then `dbt` is looked up on the project environment's `PATH`, with source `mise` or `direnv`. Then `dbt` is looked up on the host `PATH`, with source `PATH`. For a mise or direnv environment, entries named `shims` are removed from the project `PATH` before the lookup, because a mise shim chooses its version from the directory it runs in. A mise shim therefore never counts as the project's `dbt`. If the project `PATH` holds only shims, the lookup falls back to the host `PATH`. The host `PATH` lookup is not filtered, so a shim there is still found, with source `PATH`. If the project `PATH` hit is the same file as the host hit, its source is reported as `PATH`. An invalid `fusionPowerUser.dbtPath` reports the project as not found and does not fall back to `PATH`. `dbt --version` runs with the project environment.

**Not decided here.** The extension does not parse `.env`. Fusion loads it itself.

**Rejected (D1).**

- Depend on the `hverlin.mise-vscode` extension, which has one environment per window and no ordering between mise and direnv.
- Read `mise.toml` in the extension, which re-implements mise.
- Off by default, which would hide the feature from users who have not set anything.
- Layer direnv over mise, which combines two sources the user wants kept apart.

## Consequences

- A project's mise or direnv declarations take effect without per-machine settings. A project with no tool-manager config behaves as before.
- The extension runs `mise` and `direnv` as read-only subprocesses in trusted workspaces. It still never installs, trusts or allows anything, and `AGENTS.md` and ADR 0004 state the exception.
- A failed tool-manager run logs a warning for that project, and that project uses the host environment. An untrusted config shows a notification that names the command to run, and the extension does not run it.
- If the resolved environment sets a project-directory variable such as `DBT_ENGINE_PROJECT_DIR`, the extension logs one info line that it is ignored, because `--project-dir` takes precedence.
