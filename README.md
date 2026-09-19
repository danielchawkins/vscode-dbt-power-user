# Fusion Power User

A local-first VS Code / Cursor extension for [dbt Fusion](https://docs.getdbt.com/docs/fusion/about-fusion) projects.
The native dbt Fusion language server owns editor intelligence — completion, diagnostics, hover, navigation, rename,
and formatting all come from the same engine that builds your project.

No account, no API key, no hosted services, no telemetry. Every feature works against your local dbt Fusion
installation and your own warehouse credentials.

> **Status: pre-release.** This is an independent fork of
> [`vscode-dbt-power-user`](https://github.com/AltimateAI/vscode-dbt-power-user), rebuilt around the Fusion language
> server. It is macOS-only and under active development.

## Requirements

- dbt Fusion 2.0.5 or later on your `PATH`, or configured via `fusionPowerUser.dbtPath`
- macOS
- VS Code 1.95 or later, or a matching Cursor build

The extension does not install, update, or manage dbt. Install Fusion however you prefer — mise, Homebrew, or the
official installer — and the extension will use it.

## Install

Download the `.vsix` from [Releases](https://github.com/danielchawkins/vscode-dbt-power-user/releases), verify the
published SHA-256 checksum, and install it:

```bash
code --install-extension fusion-power-user-<version>.vsix
# or
cursor --install-extension fusion-power-user-<version>.vsix
```

Uninstall `innoverio.vscode-dbt-power-user` first. Both extensions claim the same files, and Fusion Power User refuses
to start while the upstream extension is present.

## Scope

Supported: local dbt Fusion projects — compile and preview, query execution and analysis, run / build / test, model and
column lineage, project trees, and local documentation editing.

Not supported, by design: dbt Core, dbt Cloud, hosted APIs, AI features, collaboration, MCP, and notebooks.

## Contributing

This is a personal fork with no upstream merge path. See [`AGENTS.md`](AGENTS.md) for the development environment and
[`docs/refactor/`](docs/refactor/) for the plan.

## License

MIT. Derived from `vscode-dbt-power-user`, © 2020 innover.io. See [`LICENSE`](LICENSE).
