// lint-expect: oxlint react/purity
export function C() {
  return <div>{Math.random()}</div>;
}
