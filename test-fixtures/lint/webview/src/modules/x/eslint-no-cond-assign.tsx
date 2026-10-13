// lint-expect: oxlint eslint/no-cond-assign
export function f(a?: number): number {
  let b: number | undefined;
  if (b = a) {
    return b;
  }
  return 0;
}
