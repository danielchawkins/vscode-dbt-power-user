// lint-expect-none: any eslint/no-restricted-properties
declare const window: { showErrorMessage(message: string): void };

export function fail(): void {
  window.showErrorMessage("x");
}
