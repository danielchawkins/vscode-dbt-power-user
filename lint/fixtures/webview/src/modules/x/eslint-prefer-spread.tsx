// lint-expect: oxlint eslint/prefer-spread
const obj = {
  m(...x: number[]): number {
    return x.length;
  },
};
export const m = (a: number[]): number => obj.m.apply(obj, a);
