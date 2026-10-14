// lint-expect: oxlint eslint/prefer-object-has-own
export const has = (o: object): boolean =>
  Object.prototype.hasOwnProperty.call(o, "k");
