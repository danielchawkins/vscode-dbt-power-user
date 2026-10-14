// lint-expect: oxlint eslint/no-constant-condition
export function f(): number {
  if (true) {
    return 1;
  }
  return 0;
}
