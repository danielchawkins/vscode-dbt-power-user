// lint-expect: oxlint typescript/no-misused-promises
export function f(p: Promise<number>): number {
  if (p) {
    return 1;
  }
  return 0;
}
