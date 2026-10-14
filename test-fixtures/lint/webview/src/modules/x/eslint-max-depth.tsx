// lint-expect: oxlint eslint/max-depth
export function deep(x: number): number {
  if (x) {
    if (x) {
      if (x) {
        if (x) {
          if (x) {
            return 1;
          }
        }
      }
    }
  }
  return 0;
}
