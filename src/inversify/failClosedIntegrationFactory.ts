export function failClosedIntegrationFactory(..._args: unknown[]): never {
  throw new Error("Only dbt Fusion is supported");
}
