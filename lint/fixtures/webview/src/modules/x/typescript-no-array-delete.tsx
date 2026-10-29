// lint-expect: oxlint typescript/no-array-delete
export function f(a: number[]): number[] {
  delete a[0];
  return a;
}
