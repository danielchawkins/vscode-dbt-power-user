// lint-expect: oxlint typescript/no-unnecessary-type-constraint
export function f<T extends unknown>(a: T): T {
  return a;
}
