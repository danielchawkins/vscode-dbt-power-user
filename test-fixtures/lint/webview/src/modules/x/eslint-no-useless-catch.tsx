// lint-expect: oxlint eslint/no-useless-catch
declare function g(): number;
export function f(): number {
  try {
    return g();
  } catch (e) {
    throw e;
  }
}
