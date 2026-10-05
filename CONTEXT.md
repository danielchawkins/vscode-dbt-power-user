# Fusion Power User

Fusion Power User is a local-first editor for dbt Fusion projects. It provides dbt development workflows without hosted services, authentication, telemetry, or gated product surfaces.

## Language

**Declared Project**: A dbt project explicitly configured for editor services, or a workspace-folder root containing `dbt_project.yml` when no explicit configuration exists. *Avoid*: Allowed folder, discovered project

**Dependency Project**: A dbt package parsed as part of a Declared Project but not independently served for editing. *Avoid*: Child project, hidden project

**Current Project**: The Declared Project that owns the file or command currently being handled. *Avoid*: Selected project, active workspace

**Project Snapshot**: Everything the extension knows about one Declared Project at one revision — root, folder, resource paths from `dbt_project.yml` with dbt's defaults, and how dbt is invoked — resolved from settings, environment overrides, and one read of `dbt_project.yml`. *Avoid*: Project config, invocation context, launch settings

**Local Capability**: A feature that operates with the local dbt Fusion installation and the user's warehouse credentials, without an extension-specific account or hosted service. *Avoid*: Free feature, community feature

**Hosted Capability**: A feature that depends on an extension vendor's API, account, or hosted state. *Avoid*: Premium feature, advanced feature

**Consumer Repository**: A project that installs and configures a released Fusion Power User VSIX. *Avoid*: Client repository, downstream repository

**Fusion Client**: The reverse-socket `LanguageClient` connected to one Declared Project's `dbt lsp` process. *Avoid*: LSP connection, client wrapper

**Project Metadata Source**: The composite producer behind `Projects.onDidChangeManifest` for one Declared Project: the Server Producer first, the Parse Producer for the gaps. *Avoid*: Metadata provider, manifest producer

**Server Producer**: The Project Metadata Source half that reads `dbt.listNodes` and `dbt.getProjectInfo`. *Avoid*: LSP cache, graph source

**Parse Producer**: The Project Metadata Source half that reads `manifest.json` from `dbt parse`, for the fields in `docs/lsp-metadata-gaps.md`. *Avoid*: Manifest fallback
