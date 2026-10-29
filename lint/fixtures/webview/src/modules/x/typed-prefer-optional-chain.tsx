// lint-expect: oxlint typescript/prefer-optional-chain
export const v = (a?: { b: number }) => a && a.b;
