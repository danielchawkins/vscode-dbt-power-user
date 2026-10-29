// lint-expect: oxlint typescript/restrict-plus-operands
export function v(a: number[], b: number): string {
  return String(a + b);
}
