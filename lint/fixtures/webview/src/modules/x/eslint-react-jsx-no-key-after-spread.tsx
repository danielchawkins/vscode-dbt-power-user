// lint-expect: eslint @eslint-react/jsx-no-key-after-spread
export const Item = (props: Record<string, unknown>) => (
  <div {...props} key="a" />
);
