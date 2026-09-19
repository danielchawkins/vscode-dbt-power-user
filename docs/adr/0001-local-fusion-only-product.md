# Make the fork a local Fusion-only product

Fusion Power User will support dbt Fusion 2.0.5 and later, and will remove dbt Core, dbt Cloud, hosted Altimate
services, authentication, telemetry, AI, collaboration, MCP, and notebook features. This is an independent product fork
rather than an upstream-compatible patch set. The narrower boundary removes the Python and hosted-service architectures
that make setup intrusive and lets every visible capability work locally without an extension-specific account.
