# Fusion Power User

Fusion Power User is an independent fork of [`vscode-dbt-power-user`](https://github.com/AltimateAI/vscode-dbt-power-user) being rebuilt as a local-first VS Code and Cursor extension for [dbt Fusion](https://docs.getdbt.com/docs/fusion/about-fusion).

> **Status: developer alpha.** Repository identity and contributor tooling are in place, but the runtime is still the upstream implementation. It still contains dbt Core, dbt Cloud, hosted Altimate, telemetry, AI, MCP, and notebook paths. Do not install this build as a local-only replacement yet.

## Target

The completed product will support dbt Fusion 2.0.5 and later on macOS. The native Fusion language server will own completion, diagnostics, hover, navigation, rename, formatting, and semantic information. Retained panels and commands will use local LSP commands, Fusion artifacts, or the local Fusion CLI.

The target extension will not install dbt, call hosted services, require an extension-specific account, or collect telemetry. Those guarantees become true only as the corresponding refactor phases land.

The extension resolves dbt Fusion from the resource-scoped `fusionPowerUser.dbtPath` setting first, then from `dbt` on the extension host PATH. Configured paths support `${workspaceFolder}`, `${userHome}`, and `${env:VAR}`; an invalid configured path blocks that project's language server and does not fall back to PATH. Tool managers such as mise or Homebrew work by putting the shim on PATH; the extension never invokes a tool manager directly.

Per Declared Project, resource-scoped settings `fusionPowerUser.profilesDir`, `fusionPowerUser.target`, `fusionPowerUser.lint.enabled`, and `fusionPowerUser.trace.server` are passed to that project's Fusion language server launch. `fusionPowerUser.profilesDir` supports the same `${workspaceFolder}`, `${userHome}`, and `${env:VAR}` substitutions as `fusionPowerUser.dbtPath`. Changing any launch-affecting setting replaces the project's language server client with a new process using the updated options. `fusionPowerUser.trace.server` controls Fusion server process log verbosity only; server stdout and stderr appear in that project's Fusion LSP output channel, and debug or verbose also increase Fusion's own project log file verbosity (for example `logs/dbt.log`). The status bar names the channel and never shows a notification for startup or failure.

Upgrading from upstream or an earlier fork build requires renaming every extension-owned `dbt.*` key to `fusionPowerUser.*`; see [`docs/settings-migration.md`](docs/settings-migration.md).

## Development

```bash
scripts/workspace/setup/setup-environment.sh # first run
just setup                                  # later refreshes
just check
just package
```

Run the environment script once to install mise and bootstrap the task layer. `just setup` installs the configured contributor tools and npm dependencies, installs hooks, and configures colocated jj. Both commands accept `--force`. The shipped extension remains tool-manager-neutral and must never invoke mise or Just.

## Contributing

This is a personal fork with no upstream merge path. See [`AGENTS.md`](AGENTS.md) for the development environment and [`docs/refactor/`](docs/refactor/) for the plan.

## License

MIT. Derived from `vscode-dbt-power-user`, © 2020 innover.io. See [`LICENSE`](LICENSE).
