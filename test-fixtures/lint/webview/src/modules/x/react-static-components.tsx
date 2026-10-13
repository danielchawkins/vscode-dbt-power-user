// lint-expect: oxlint react/static-components
export function P() {
  const Inner = () => <div />;
  return <Inner />;
}
