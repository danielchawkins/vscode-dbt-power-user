// lint-expect: oxlint eslint/no-unused-labels
export function f(): number {
  outer: for (;;) {
    break;
  }
  return 1;
}
