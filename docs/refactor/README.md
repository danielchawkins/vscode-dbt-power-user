# Fusion Power User refactor

These documents define the independent, local-first Fusion Power User fork.

## Current status

Steps 1.2 through 3.7 are on `main`. The repository tooling baseline is green, dbt Fusion 2.0.5 is pinned for development and tests, and the extension packages as `danielchawkins.fusion-power-user` `0.1.0-alpha.0`.

The product runtime remains manifest-driven and still ships hosted Altimate, authentication, credits, and Python-bridge paths; telemetry, AI, MCP, collaboration, and notebooks are gone. Core and Cloud classes remain because Fusion still extends Cloud. The next PR migrates the extension host to ESM and Inversify 8, followed by the other booked dependency migrations before Phase 4. Implementation is serial, while local successor work overlaps with review and CI for its parent through dependent jj revisions. Execution rules are in [`implementation-dispatch.md`](implementation-dispatch.md).

Read in order:

1. [`../../CONTEXT.md`](../../CONTEXT.md) — canonical product language.
2. [`fusion-lsp-context.md`](fusion-lsp-context.md) — repositories, current architecture, target architecture, and contracts.
3. [`tooling-adoption.md`](tooling-adoption.md) — contributor environment decisions before product changes.
4. [`fusion-lsp-feature-disposition.md`](fusion-lsp-feature-disposition.md) — retain, replace, remove, and spike inventory.
5. [`fusion-lsp-plan.md`](fusion-lsp-plan.md) — incremental implementation and prerelease plan.
6. [`implementation-dispatch.md`](implementation-dispatch.md) — trunk, serial jj workspaces, pipelined landing, and agent handoff.
7. [`finance-pipelines-integration.md`](finance-pipelines-integration.md) — first Consumer Repository adoption.

Architectural decisions are in [`../adr/`](../adr/). Current VS Code and Cursor compatibility evidence is summarized in [`../research/vscode-extension-development-september-2026.md`](../research/vscode-extension-development-september-2026.md). The proposed colocated Jujutsu rollout is in [`../research/jujutsu-adoption-september-2026.md`](../research/jujutsu-adoption-september-2026.md).
