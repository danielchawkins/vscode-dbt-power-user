# Fusion Power User refactor

These documents define the independent, local-first Fusion Power User fork.

## Current status

The v1 refactor is complete for beta: `v0.4.0-beta.1` is published, one Fusion Client serves each Declared Project, and dbt Core, dbt Cloud, the Python bridge, and hosted Altimate code are gone. [`rearchitecture-plan.md`](rearchitecture-plan.md) is the authoritative plan from here: phases R1–R10 replace inherited indirection with one Project model, one settings module, a composition root, framework-provided editor mechanisms, one webview contract, and one styling system, then adopt the fork in finance-pipelines and cut 1.0.0. [`rearchitecture-critiques.md`](rearchitecture-critiques.md) records the three review rounds behind it.

The v1 plans — [`fusion-lsp-plan.md`](fusion-lsp-plan.md), [`remaining-implementation.md`](remaining-implementation.md), [`column-lineage-ship-plan.md`](column-lineage-ship-plan.md) and [`column-lineage-plan.md`](column-lineage-plan.md) — are closed and kept as history. Execution rules are in [`implementation-dispatch.md`](implementation-dispatch.md).

Read in order:

1. [`../../CONTEXT.md`](../../CONTEXT.md) — canonical product language.
2. [`fusion-lsp-context.md`](fusion-lsp-context.md) — repositories, current architecture, target architecture, and contracts.
3. [`tooling-adoption.md`](tooling-adoption.md) — contributor environment decisions before product changes.
4. [`fusion-lsp-feature-disposition.md`](fusion-lsp-feature-disposition.md) — retain, replace, remove, and spike inventory.
5. [`rearchitecture-plan.md`](rearchitecture-plan.md) — the plan: target model, phases R1–R10, conventions, and dependency targets.
6. [`../research/codebase-audit-host-september-2026.md`](../research/codebase-audit-host-september-2026.md), [`../research/codebase-audit-webview-september-2026.md`](../research/codebase-audit-webview-september-2026.md) and [`../research/vscode-extension-practice-september-2026.md`](../research/vscode-extension-practice-september-2026.md) — the evidence the plan cites.
7. [`implementation-dispatch.md`](implementation-dispatch.md) — trunk, serial jj workspaces, pipelined landing, and agent handoff.
8. [`finance-pipelines-integration.md`](finance-pipelines-integration.md) — first Consumer Repository adoption.

Architectural decisions are in [`../adr/`](../adr/).

Research holds evidence, measurements, and rationale; the plan holds decisions, contracts, order, and verification. All of it lives in [`../research/`](../research/).

- [`vscode-extension-development-september-2026.md`](../research/vscode-extension-development-september-2026.md) — VS Code and Cursor platform and compatibility evidence.
- [`jujutsu-adoption-september-2026.md`](../research/jujutsu-adoption-september-2026.md) — the colocated Jujutsu rollout.
- [`vscode-webview-architecture-north-star-september-2026.md`](../research/vscode-webview-architecture-north-star-september-2026.md) — the measured extension/webview baseline and v2 architecture.
- [`modern-webview-ui-september-2026.md`](../research/modern-webview-ui-september-2026.md) — React 19, Tailwind 4, and VS Code webview practice.
- [`dbt-fusion-interactive-data-path-september-2026.md`](../research/dbt-fusion-interactive-data-path-september-2026.md) and its [sources ledger](../research/dbt-fusion-interactive-data-path-september-2026-sources.md) — project-state, cache, latency, and Snowflake evidence.
- [`fusion-editor-flow-evidence.md`](fusion-editor-flow-evidence.md) — historical: opt-in Phase 5.6 native editor-flow capture (`FPU_RUN_EDITOR_FLOW_CAPTURE=1`); step 5.6 is complete and the ship plan retires the capture.
- [`../research/evidence/README.md`](../research/evidence/README.md) — consolidated Fusion 2.0.6 evidence for static-analysis configuration, native editor features, and column lineage; authoritative over the per-area run records beside it.
