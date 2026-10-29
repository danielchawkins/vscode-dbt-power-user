// lint-expect: oxlint eslint/no-loop-func
export function f(n: number): Array<() => number> {
  const fns: Array<() => number> = [];
  for (var i = 0; i < n; i++) {
    fns.push(() => i);
  }
  return fns;
}
