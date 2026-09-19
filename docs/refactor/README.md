# Fusion Power User refactor

These documents define the independent, local-first Fusion Power User fork.

## Current status

Phase 0 is complete. The branch is rebased onto upstream 0.64.6, the repository tooling baseline is green, dbt Fusion 2.0.5 is pinned for development and tests, and the extension packages as `danielchawkins.fusion-power-user` `0.1.0-alpha.0`.

The product runtime is not local-only yet. It still contains the inherited Core, Cloud, hosted Altimate, telemetry, AI, MCP, and notebook paths. The next implementation step is Phase 1.2: add the Fusion version resolver and gate. Phase 1.3 then adds the upstream-extension conflict guard and the resource-scoped enabled setting. Do not start Phase 2 until both gates are covered by unit tests.

Read in order:

1. [`../../CONTEXT.md`](../../CONTEXT.md) — canonical product language.
2. [`fusion-lsp-context.md`](fusion-lsp-context.md) — repositories, current architecture, target architecture, and contracts.
3. [`tooling-adoption.md`](tooling-adoption.md) — contributor environment decisions before product changes.
4. [`fusion-lsp-feature-disposition.md`](fusion-lsp-feature-disposition.md) — retain, replace, remove, and spike inventory.
5. [`fusion-lsp-plan.md`](fusion-lsp-plan.md) — incremental implementation and prerelease plan.
6. [`finance-pipelines-integration.md`](finance-pipelines-integration.md) — first Consumer Repository adoption.

Architectural decisions are in [`../adr/`](../adr/). Current VS Code and Cursor compatibility evidence is summarized in [`../research/vscode-extension-development-september-2026.md`](../research/vscode-extension-development-september-2026.md). The proposed colocated Jujutsu rollout is in [`../research/jujutsu-adoption-september-2026.md`](../research/jujutsu-adoption-september-2026.md).
