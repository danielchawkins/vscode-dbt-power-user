# Fusion Power User

Fusion Power User is an independent, local-first VS Code and Cursor extension for [dbt Fusion](https://docs.getdbt.com/docs/fusion/about-fusion), forked from [`vscode-dbt-power-user`](https://github.com/AltimateAI/vscode-dbt-power-user). The native Fusion language server runs alongside the legacy manifest-backed completion, definition, and hover providers inherited from the fork base; the refactor plan's step 5.6 deletes each legacy provider once its LSP-backed replacement has a passing test. No feature depends on a hosted service, an extension-specific account, or telemetry.

## Scope

macOS only. Requires dbt Fusion 2.0.5 or later; an untested newer major logs one warning and continues. The extension does not support dbt Core or dbt Cloud, call hosted APIs, require an account, collect telemetry, or install or update dbt.

## Install

Fusion Power User ships as a VSIX attached to a [GitHub Release](https://github.com/danielchawkins/vscode-dbt-power-user/releases), checksummed with SHA-256. There is no marketplace or OpenVSX publication.

Requirements: VS Code or Cursor on Extensions API 1.128 or later, and dbt Fusion 2.0.5 or later on `PATH` or at `fusionPowerUser.dbtPath`. The upstream dbt Power User (`innoverio.vscode-dbt-power-user`) must not be installed; Fusion Power User refuses to start beside it.

```sh
# 1. Download a release and verify it (replace the tag).
gh release download v0.4.0-beta.1 -R danielchawkins/vscode-dbt-power-user --dir /tmp/fpu
cd /tmp/fpu && shasum -a 256 -c vsix.sha256

# 2. Remove the upstream extension if present.
code --uninstall-extension innoverio.vscode-dbt-power-user

# 3. Install; --force replaces an installed version.
code --install-extension fusion-power-user-0.4.0-beta.1.vsix --force
cursor --install-extension fusion-power-user-0.4.0-beta.1.vsix --force

# 4. Confirm, then run "Developer: Reload Window" in each open window.
code --list-extensions --show-versions | grep fusion-power-user
```

Without the `gh` CLI, download `fusion-power-user-<version>.vsix` and `vsix.sha256` from the release page; in the editor, **Extensions → … → Install from VSIX…** does the same as step 3.

- **Upgrade:** repeat the steps with the new tag. `--force` replaces the old version in place; settings are kept.
- **Uninstall:** `code --uninstall-extension danielchawkins.fusion-power-user`.
- **From source:** `just package` builds the VSIX from the working copy and records its path in `out/latest-vsix`; install it with `code --install-extension "$(cat out/latest-vsix)" --force`.

Pin a specific version and its checksum rather than tracking a moving release; see [`docs/releasing.md`](docs/releasing.md) for rollback.

## dbt Fusion resolution

The extension resolves dbt Fusion independently per Declared Project: the resource-scoped `fusionPowerUser.dbtPath` setting first, then `dbt` on the extension host `PATH`. Configured paths support `${workspaceFolder}`, `${userHome}`, and `${env:VAR}`; an invalid configured path blocks that project's language server and does not fall back to `PATH`. The extension is tool-manager-neutral: it never invokes or special-cases mise, asdf, Homebrew, or any other tool manager. A tool manager that puts its shimmed `dbt` on `PATH` — for example [`mise-vscode`](https://github.com/hverlin/mise-vscode)'s binary-extension mechanism — needs no extension-side integration, because honoring `PATH` already covers it.

Per Declared Project, resource-scoped settings `fusionPowerUser.profilesDir`, `fusionPowerUser.target`, `fusionPowerUser.lint.enabled`, and `fusionPowerUser.trace.server` are passed to that project's Fusion language server launch; `fusionPowerUser.profilesDir` is also passed as `--profiles-dir` to every CLI command the extension runs. Without it the extension adds no profiles flag, so dbt resolves `profiles.yml` the same way it would in a terminal opened in the project folder, including any `DBT_PROFILES_DIR` or `DBT_ENGINE_PROFILES_DIR` in the environment VS Code gives the extension. `fusionPowerUser.profilesDir` supports the same `${workspaceFolder}`, `${userHome}`, and `${env:VAR}` substitutions as `fusionPowerUser.dbtPath`. Changing any launch-affecting setting replaces the project's language server client with a new process using the updated options. `fusionPowerUser.trace.server` controls Fusion server process log verbosity only; server stdout and stderr appear in that project's Fusion LSP output channel, and debug or verbose also increase Fusion's own project log file verbosity (for example `logs/dbt.log`). The status bar names the channel and never shows a notification for startup or failure.

Upgrading from upstream or an earlier fork build requires renaming every extension-owned `dbt.*` key to `fusionPowerUser.*`; see [`docs/settings-migration.md`](docs/settings-migration.md).

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for activation, Declared Projects, the Fusion client pool, the metadata port, and the panels.

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
