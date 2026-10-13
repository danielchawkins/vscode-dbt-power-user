// lint-expect: oxlint typescript/no-floating-promises
async function p(): Promise<number> {
  return 1;
}
export function g(): void {
  p();
}
