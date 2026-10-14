// lint-expect: oxlint eslint/no-duplicate-case
export function f(a: number): number {
  switch (a) {
    case 1:
      return 1;
    case 1:
      return 2;
    default:
      return 0;
  }
}
