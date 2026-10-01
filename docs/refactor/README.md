# Fusion Power User refactor

The v1 refactor is complete for beta: `v0.4.0-beta.1` is published, one Fusion Client serves each Declared Project, and dbt Core, dbt Cloud, the Python bridge and hosted Altimate code are gone. The rearchitecture plan governs the work from here.

- [`rearchitecture-plan.md`](rearchitecture-plan.md) — the plan: target model, phases R1–R10 with their results, naming conventions and dependency targets.
- [`implementation-dispatch.md`](implementation-dispatch.md) — how each step is implemented, reviewed and landed as a PR against `main`.
- [`finance-pipelines-integration.md`](finance-pipelines-integration.md) — the first Consumer Repository and its adoption contract (R9).
- [`../../CONTEXT.md`](../../CONTEXT.md) — canonical product language.
- [`../adr/`](../adr/) — architectural decisions.
- [`../architecture.md`](../architecture.md) — how the extension is built today, including the Fusion client launch contract.
- [`../research/`](../research/) — dated evidence and measurements the plan and ADRs cite; [`../research/evidence/README.md`](../research/evidence/README.md) is authoritative for Fusion behaviour.
