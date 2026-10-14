// lint-expect: oxlint unicorn/prefer-optional-catch-binding
export function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
}
