# Fusion Power User

Fusion Power User is a local-first editor for dbt Fusion projects. It provides dbt development workflows without hosted services, authentication, telemetry, or gated product surfaces.

## Language

**Declared Project**: A dbt project explicitly configured for editor services, or a workspace-folder root containing `dbt_project.yml` when no explicit configuration exists. *Avoid*: Allowed folder, discovered project

**Dependency Project**: A dbt package parsed as part of a Declared Project but not independently served for editing. *Avoid*: Child project, hidden project

**Project Context**: The Declared Project that owns the file or command currently being handled. *Avoid*: Selected project, active workspace

**Local Capability**: A feature that operates with the local dbt Fusion installation and the user's warehouse credentials, without an extension-specific account or hosted service. *Avoid*: Free feature, community feature

**Hosted Capability**: A feature that depends on an extension vendor's API, account, or hosted state. *Avoid*: Premium feature, advanced feature

**Consumer Repository**: A project that installs and configures a released Fusion Power User VSIX. *Avoid*: Client repository, downstream repository

**Fusion Client**: The reverse-socket `LanguageClient` connected to one Declared Project's `dbt lsp` process. *Avoid*: LSP connection, client wrapper

**Project Metadata Source**: The producer behind `ManifestCacheProjectAddedEvent` for one Declared Project. *Avoid*: Metadata provider, manifest producer
