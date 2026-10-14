// lint-expect: oxlint eslint/no-useless-assignment
export function f(): number {
  let a = 1;
  a = 2;
  return a;
}
