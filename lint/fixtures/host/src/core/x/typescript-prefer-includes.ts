// lint-expect: oxlint typescript/prefer-includes
export const found = (xs: string[], x: string): boolean => xs.indexOf(x) !== -1;
