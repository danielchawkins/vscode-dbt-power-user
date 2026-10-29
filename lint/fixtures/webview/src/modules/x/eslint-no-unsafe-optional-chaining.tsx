// lint-expect: oxlint eslint/no-unsafe-optional-chaining
declare const o: { b: { a: number } } | undefined;
export const { a } = o?.b;
