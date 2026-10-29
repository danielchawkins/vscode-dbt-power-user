// lint-expect: oxlint eslint/no-case-declarations
export function f(x: number): number {
  switch (x) {
    case 1:
      const y = 2;
      return y;
    default:
      return 0;
  }
}
