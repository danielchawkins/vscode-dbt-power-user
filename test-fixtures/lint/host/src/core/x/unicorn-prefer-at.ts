// lint-expect: oxlint unicorn/prefer-at
export const last = (xs: number[]): number | undefined => xs[xs.length - 1];
