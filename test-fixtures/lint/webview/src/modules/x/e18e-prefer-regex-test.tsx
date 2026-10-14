// lint-expect: oxlint e18e/prefer-regex-test
export function hasA(s: string): boolean {
  if (/a/.exec(s)) {
    return true;
  }
  return false;
}
