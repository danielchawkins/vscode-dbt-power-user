// lint-expect: oxlint typescript/prefer-nullish-coalescing
export const v = (a?: string) => a || "x";
