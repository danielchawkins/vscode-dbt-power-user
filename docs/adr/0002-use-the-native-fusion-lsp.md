# Use the native Fusion LSP for editor intelligence

Fusion Power User will run one native `dbt lsp` process per Declared Project and use it for completion, diagnostics,
hover, navigation, references, rename, formatting, code actions, and semantic information. Local panels will call dbt
LSP commands first and read Fusion artifacts only where the protocol lacks required data. The fork will remove its
parallel manifest-driven language providers and parse loop because two independent semantic models produce duplicate
work and inconsistent editor results.
