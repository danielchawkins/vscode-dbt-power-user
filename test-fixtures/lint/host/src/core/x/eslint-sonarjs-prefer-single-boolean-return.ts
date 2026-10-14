// lint-expect: eslint sonarjs/prefer-single-boolean-return
export function f(a: boolean): boolean {
  if (a) {
    return true;
  } else {
    return false;
  }
}
