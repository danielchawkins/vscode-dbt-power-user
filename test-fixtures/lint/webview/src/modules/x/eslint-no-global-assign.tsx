// lint-expect: oxlint eslint/no-global-assign
export function f(): number {
  NaN = 1;
  return 0;
}
