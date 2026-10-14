// lint-expect: oxlint eslint/no-ex-assign
declare function g(): void;
export function f(): number {
  try {
    g();
  } catch (e) {
    e = 1;
    return Number(e);
  }
  return 0;
}
