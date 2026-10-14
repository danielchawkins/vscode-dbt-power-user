// lint-expect: oxlint typescript/only-throw-error
export function fail(): never {
  throw "boom";
}
