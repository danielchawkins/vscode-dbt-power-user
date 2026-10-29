// lint-expect-none: any eslint/no-restricted-syntax
declare const window: { postMessage(m: unknown): void };

export function send(m: unknown): void {
  window.postMessage(m);
}
