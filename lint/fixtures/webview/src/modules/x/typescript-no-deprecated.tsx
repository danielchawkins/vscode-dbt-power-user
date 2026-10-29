// lint-expect: oxlint typescript/no-deprecated
/** @deprecated use current() instead */
export function legacy(): number {
  return 1;
}
export const v = legacy();
