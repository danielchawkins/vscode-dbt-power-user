// lint-expect: oxlint react/unsupported-syntax
export function C() {
  const x = eval("1");
  return <div>{x}</div>;
}
