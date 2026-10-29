// lint-expect: oxlint eslint/no-param-reassign
export function f(a: number): number {
  a = 2;
  return a;
}
