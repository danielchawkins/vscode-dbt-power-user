// lint-expect: oxlint typescript/prefer-nullish-coalescing
export const label = (a: string | undefined): string => a || "none";
