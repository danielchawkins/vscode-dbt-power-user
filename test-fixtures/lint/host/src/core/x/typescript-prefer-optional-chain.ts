// lint-expect: oxlint typescript/prefer-optional-chain
export const c = (a: { b?: { c?: number } }) => a && a.b && a.b.c;
