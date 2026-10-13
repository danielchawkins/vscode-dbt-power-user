// lint-expect: oxlint typescript/no-for-in-array
export function f(a: number[]): string[] {
  const out: string[] = [];
  for (const k in a) {
    out.push(k);
  }
  return out;
}
