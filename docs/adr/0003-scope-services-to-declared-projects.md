# Scope editor services to Declared Projects

Fusion Power User will automatically serve a workspace-folder root containing `dbt_project.yml`, while explicit folder-scoped project paths handle nested or otherwise ambiguous layouts. Each Declared Project owns one LSP process; dbt remains responsible for parsing its packages, cross-project references, and ignore rules. A Dependency Project does not receive independent editor services unless the user also declares it as a project, preventing recursive discovery from registering copied packages or unrelated dbt trees.
