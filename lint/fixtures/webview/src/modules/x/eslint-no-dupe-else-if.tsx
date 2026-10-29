// lint-expect: oxlint eslint/no-dupe-else-if
export function f(a: number): number {
  if (a === 1) {
    return 1;
  } else if (a === 1) {
    return 2;
  }
  return 0;
}
