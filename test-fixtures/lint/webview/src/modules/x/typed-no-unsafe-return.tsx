// lint-expect: oxlint typescript/no-unsafe-return
declare const a: any;
export function f(): string {
  return a;
}
