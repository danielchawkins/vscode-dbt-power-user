// lint-expect: oxlint eslint/no-prototype-builtins
export const h = (o: object) => o.hasOwnProperty("x");
