// lint-expect: oxlint typescript/no-non-null-asserted-optional-chain
export const v = (o?: { a: number }) => o?.a!;
