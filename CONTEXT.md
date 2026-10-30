# Fusion Power User

Fusion Power User is a local-first editor for dbt Fusion projects. It provides dbt development workflows without hosted services, authentication, telemetry, or gated product surfaces.

## Language

**Declared Project**: A dbt project explicitly configured for editor services, or a workspace-folder root containing `dbt_project.yml` when no explicit configuration exists, or by opening a file inside an enabled workspace folder, for the session. *Avoid*: Allowed folder, discovered project

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

**Column Proposal**: A pending `data_type` or description for one column, labelled with its source (target, deferred, inferred or an upstream column), that the user accepts in the documentation editor before Save writes it. *Avoid*: Suggestion, sync result

**Group**: A collapsed set of one expansion's new neighbours that share a folder, drawn in the lineage panel as one node with a member count. *Avoid*: Cluster, bucket

**Filtered-out Table**: A lineage table whose dbt model sets `meta.lineage.hidden: true`. It is drawn as a card with no table, group or column edge. The start table is never filtered out. *Avoid*: Hidden table, hidden node

**Capped Neighbours**: The neighbours an expansion fetched but does not draw, because `lineage.maxNeighbours` limits the draw; shown as a `+N` on the card's expander. *Avoid*: Hidden neighbours, overflow

**Undrawn Member**: A member of an open Group that its chip does not draw yet, shown as `+K` on the chip. *Avoid*: Hidden member, remainder

**Visible Graph**: The one projection of what the lineage view shows, decided from the graph state: the drawn cards, the Filtered-out Tables and which cards take part in edges. Cards and every edge read it, so they cannot disagree. *Avoid*: Drawn set, visible set

**Layout Input**: What the lineage layout engine reads: the drawn graph, card sizes and the options. It never holds the selection or the open file. *Avoid*: Flow input, layout request

**Decoration**: What the lineage view draws over a layout without moving any card or edge: the selection, the highlight, the open file, colours and labels. *Avoid*: Flow input, style props
