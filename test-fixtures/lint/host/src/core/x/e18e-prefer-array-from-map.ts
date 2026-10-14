// lint-expect: oxlint e18e/prefer-array-from-map
export const bumped = (xs: number[]): number[] => [...xs].map((x) => x + 1);
