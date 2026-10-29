// lint-expect: oxlint typescript/prefer-for-of
export function f(a: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
  }
  return s;
}
