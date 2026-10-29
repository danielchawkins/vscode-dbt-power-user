// lint-expect: oxlint e18e/prefer-array-to-sorted
export const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
