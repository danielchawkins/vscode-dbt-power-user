// lint-expect: oxlint typescript/unbound-method
export class C {
  m(): void {}
}
export const f = (c: C) => {
  const u = c.m;
  return u;
};
