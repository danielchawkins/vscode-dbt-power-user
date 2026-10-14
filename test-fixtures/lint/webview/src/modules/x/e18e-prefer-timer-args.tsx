// lint-expect: oxlint e18e/prefer-timer-args
export function later(f: (n: number) => void): void {
  setTimeout(() => f(1), 0);
}
