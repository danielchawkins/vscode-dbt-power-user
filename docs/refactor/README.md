# Fusion Power User refactor

These documents define the independent, local-first Fusion Power User fork.

## Current status

Steps 1.2 and 1.3, all of Phase 2, steps 3.1 through 3.15, Phase 4.1's folder-scoped Declared Project resolver, and Phase 4.2's Project Registry are complete at this tip. Pinned VS Code and unauthenticated Cursor each have acquisition, packaged-VSIX smoke, host metadata, and ten fresh-process activation/FCP/ready samples; their Chromium 148 compatibility ceiling drives the webview build target. The repository tooling baseline is green, dbt Fusion 2.0.5 is pinned for development and tests, and the extension packages as `danielchawkins.fusion-power-user` `0.1.0-alpha.0`.

The product runtime remains manifest-driven and still ships hosted Altimate, authentication, credits, and Python-bridge paths; telemetry, AI, MCP, collaboration, and notebooks are gone. Core and Cloud stay constructible because the external `DBTProjectIntegrationAdapter` requires their factories; the published Fusion integration does not extend Cloud, and retiring that adapter — which also owns the ambient target watcher — is what unblocks their removal.

Next is Phase 4.3's Project Context. Implementation is serial, while local successor work overlaps with review and CI for its parent through dependent jj revisions. Execution rules are in [`implementation-dispatch.md`](implementation-dispatch.md).

Read in order:

1. [`../../CONTEXT.md`](../../CONTEXT.md) — canonical product language.
2. [`fusion-lsp-context.md`](fusion-lsp-context.md) — repositories, current architecture, target architecture, and contracts.
3. [`tooling-adoption.md`](tooling-adoption.md) — contributor environment decisions before product changes.
4. [`fusion-lsp-feature-disposition.md`](fusion-lsp-feature-disposition.md) — retain, replace, remove, and spike inventory.
5. [`fusion-lsp-plan.md`](fusion-lsp-plan.md) — the spec: v1 phases and prereleases in Section 3, the v2 north-star horizon in Section 4.
6. [`implementation-dispatch.md`](implementation-dispatch.md) — trunk, serial jj workspaces, pipelined landing, and agent handoff.
7. [`finance-pipelines-integration.md`](finance-pipelines-integration.md) — first Consumer Repository adoption.

Architectural decisions are in [`../adr/`](../adr/).

Research holds evidence, measurements, and rationale; the plan holds decisions, contracts, order, and verification. All of it lives in [`../research/`](../research/).

- [`vscode-extension-development-september-2026.md`](../research/vscode-extension-development-september-2026.md) — VS Code and Cursor platform and compatibility evidence.
- [`jujutsu-adoption-september-2026.md`](../research/jujutsu-adoption-september-2026.md) — the colocated Jujutsu rollout.
- [`vscode-webview-architecture-north-star-september-2026.md`](../research/vscode-webview-architecture-north-star-september-2026.md) — the measured extension/webview baseline and v2 architecture.
- [`modern-webview-ui-september-2026.md`](../research/modern-webview-ui-september-2026.md) — React 19, Tailwind 4, and VS Code webview practice.
- [`dbt-fusion-interactive-data-path-september-2026.md`](../research/dbt-fusion-interactive-data-path-september-2026.md) and its [sources ledger](../research/dbt-fusion-interactive-data-path-september-2026-sources.md) — project-state, cache, latency, and Snowflake evidence.
