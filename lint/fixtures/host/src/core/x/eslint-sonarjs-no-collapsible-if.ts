// lint-expect: eslint sonarjs/no-collapsible-if
export const f = (a: boolean, b: boolean) => {
  if (a) {
    if (b) {
      return 1;
    }
  }
  return 0;
};
