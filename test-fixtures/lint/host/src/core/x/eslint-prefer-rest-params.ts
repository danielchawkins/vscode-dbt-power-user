// lint-expect: oxlint eslint/prefer-rest-params
export function first(): unknown {
  return arguments[0];
}
