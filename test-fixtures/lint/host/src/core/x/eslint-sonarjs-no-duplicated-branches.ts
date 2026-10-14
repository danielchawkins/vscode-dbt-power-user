// lint-expect: eslint sonarjs/no-duplicated-branches
export function f(a: number): number {
  if (a > 1) {
    const b = a * 2;
    return b + 1;
  } else {
    const b = a * 2;
    return b + 1;
  }
}
