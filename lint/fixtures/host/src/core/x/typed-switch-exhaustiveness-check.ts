// lint-expect: oxlint typescript/switch-exhaustiveness-check
export type K = "a" | "b";
export function f(k: K): number {
  switch (k) {
    case "a":
      return 1;
  }
  return 0;
}
