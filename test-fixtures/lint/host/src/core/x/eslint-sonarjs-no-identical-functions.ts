// lint-expect: eslint sonarjs/no-identical-functions
export function first(a: number) {
  const b = a + 1;
  const c = b * 2;
  return c - 1;
}

export function second(a: number) {
  const b = a + 1;
  const c = b * 2;
  return c - 1;
}
