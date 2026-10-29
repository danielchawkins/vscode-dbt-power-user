// lint-expect: oxlint eslint/no-empty
declare function g(): void;
export function f(): void {
  try {
    g();
  } catch {}
}
