// lint-expect: oxlint eslint/no-fallthrough
export function f(a: number): number {
  switch (a) {
    case 1:
      a++;
    case 2:
      return a;
    default:
      return 0;
  }
}
