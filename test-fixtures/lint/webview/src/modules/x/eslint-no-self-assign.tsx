// lint-expect: oxlint eslint/no-self-assign
export function f(): number {
  let a = 1;
  a = a;
  return a;
}
