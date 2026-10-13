// lint-expect: oxlint typescript/return-await
declare function g(): Promise<number>;
export async function f(): Promise<number> {
  return await g();
}
