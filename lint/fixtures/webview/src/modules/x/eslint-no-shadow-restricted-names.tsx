// lint-expect: oxlint eslint/no-shadow-restricted-names
export function f(): number {
  const NaN = 1;
  return NaN;
}
