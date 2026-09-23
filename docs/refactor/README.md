# Fusion Power User refactor

These documents define the independent, local-first Fusion Power User fork.

## Current status

Phases 0 through 4 are complete. Phase 5 is complete through 5.5: one `FusionClient` per Declared Project runs over the reverse-socket transport, and Fusion diagnostics pass through unfiltered per D3. Step 5.6, deleting the legacy manifest-backed `autocompletion_provider`, `definition_provider`, and `hover_provider` in favor of that client, is still open — they remain registered in `dbtPowerUserExtension.ts` today, gated on each replacement's production-shaped flow test and the editor-flow evidence in `fusion-editor-flow-evidence.md`. Phase 6 is settled — 6.3's producer flip stays deferred by design, since no LSP producer can discharge the full metadata contract. Phase 7's operation-routing steps are tracked in the plan; see its per-step status there rather than here. Phase 8 (dbt Core and dbt Cloud removal, the Python bridge, and Altimate/hosted remnants) is complete, and steps 9.1 through 9.4 are complete: the `fusionPowerUser.*` namespace rename, this documentation set, the extended VSIX smoke assertions, and the tag-triggered release pipeline. Project Registry defines the served project set, DBTProjectContainer is its sole DBTProject producer, and Project Context selects only Declared Projects. `DBTProjectIntegrationAdapter` is retired from production code; Core and Cloud are no longer constructible. The repository tooling baseline is green, dbt Fusion 2.0.5 is pinned for development and tests, and the extension packages as `danielchawkins.fusion-power-user` `0.2.0-alpha.0`.

The product runtime remains manifest-driven: the Fusion LSP payload cannot populate the full metadata contract (see [`../lsp-metadata-gaps.md`](../lsp-metadata-gaps.md)), so `ManifestMetadataSource` remains the only `ProjectMetadataSource`. Telemetry, AI, MCP, collaboration, credits, notebooks, hosted Altimate, authentication, and the Python bridge are gone.

Next is step 5.6, deleting the legacy language providers behind their LSP replacements; then Phase 10, consumer adoption in the finance-pipelines Consumer Repository; then the 1.0.0 release. Execution rules are in [`implementation-dispatch.md`](implementation-dispatch.md).

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
- [`fusion-editor-flow-evidence.md`](fusion-editor-flow-evidence.md) — opt-in Phase 5.6 native editor-flow capture (`FPU_RUN_EDITOR_FLOW_CAPTURE=1`); gates provider deletion with S10.
