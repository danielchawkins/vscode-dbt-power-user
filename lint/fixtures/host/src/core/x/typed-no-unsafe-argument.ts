// lint-expect: oxlint typescript/no-unsafe-argument
declare const a: any;
export function take(x: string): string {
  return x;
}
export const r = take(a);
