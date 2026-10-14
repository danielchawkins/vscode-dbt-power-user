// lint-expect: oxlint typescript/await-thenable
export async function f(): Promise<void> {
  await 1;
}
