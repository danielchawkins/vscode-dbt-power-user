// lint-expect: oxlint eslint/no-extra-boolean-cast
export const b = (a: string) => {
  if (!!a) {
    return 1;
  }
  return 0;
};
