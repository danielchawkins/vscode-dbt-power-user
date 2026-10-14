// lint-expect: oxlint eslint/no-unsafe-finally
export function f(): number {
  try {
    return 1;
  } finally {
    return 2;
  }
}
