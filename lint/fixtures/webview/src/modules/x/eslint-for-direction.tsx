// lint-expect: oxlint eslint/for-direction
export function f(): void {
  for (let i = 0; i < 10; i--) {
    void i;
  }
}
