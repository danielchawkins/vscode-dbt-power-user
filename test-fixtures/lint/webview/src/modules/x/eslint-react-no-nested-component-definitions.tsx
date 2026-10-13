// lint-expect: eslint @eslint-react/no-nested-component-definitions
export const Outer = () => {
  const Inner = () => <div />;
  return <Inner />;
};
