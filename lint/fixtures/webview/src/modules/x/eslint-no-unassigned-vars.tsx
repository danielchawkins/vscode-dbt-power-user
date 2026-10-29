// lint-expect: oxlint eslint/no-unassigned-vars
let a: number | undefined;
export function f(): number | undefined {
  return a;
}
