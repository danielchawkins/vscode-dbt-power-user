// lint-expect: oxlint eslint/no-debugger
export function f(): number {
  debugger;
  return 1;
}
