// lint-expect: oxlint typescript/adjacent-overload-signatures
export function f(a: string): void;
export function g(): void {}
export function f(a: number): void;
export function f(a: unknown): void {
  void a;
}
