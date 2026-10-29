// lint-expect: oxlint eslint/preserve-caught-error
declare function g(): void;
export function f(): void {
  try {
    g();
  } catch (e) {
    throw new Error("x");
  }
}
