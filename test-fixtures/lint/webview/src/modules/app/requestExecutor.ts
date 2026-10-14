// lint-expect-none: any eslint/no-restricted-syntax
declare const vscode: { postMessage(m: unknown): void };

export function send(m: unknown): void {
  vscode.postMessage(m);
}
