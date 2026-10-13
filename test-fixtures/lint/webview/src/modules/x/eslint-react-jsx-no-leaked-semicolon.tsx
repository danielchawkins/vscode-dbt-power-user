// lint-expect: eslint @eslint-react/jsx-no-leaked-semicolon
export const Line = (props: { n: number }) => (
  <div>
    <br />;
    {props.n}
  </div>
);
