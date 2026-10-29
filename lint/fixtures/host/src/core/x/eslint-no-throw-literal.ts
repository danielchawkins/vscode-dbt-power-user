// lint-expect: oxlint eslint/no-throw-literal
export function fail(): never {
  throw "boom";
}
