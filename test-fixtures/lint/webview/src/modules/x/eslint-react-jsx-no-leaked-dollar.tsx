// lint-expect: eslint @eslint-react/jsx-no-leaked-dollar
export const Price = (props: { n: number }) => (
  <p>
    Price: ${"{"}
    {props.n}
  </p>
);
