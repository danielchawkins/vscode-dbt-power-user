// lint-expect: oxlint unicorn/prefer-set-has
const allowed = ["read", "write"];
export const ok = (x: string): boolean => allowed.includes(x);
