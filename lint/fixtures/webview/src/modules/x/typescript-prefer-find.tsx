// lint-expect: oxlint typescript/prefer-find
export const v = (a: number[]) => a.filter((x) => x > 1)[0];
