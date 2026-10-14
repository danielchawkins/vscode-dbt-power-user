// lint-expect: eslint @eslint-react/no-missing-key
export const List = (props: { items: string[] }) => (
  <ul>
    {props.items.map((item) => (
      <li>{item}</li>
    ))}
  </ul>
);
