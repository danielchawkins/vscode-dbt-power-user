// lint-expect: eslint @eslint-react/no-children-for-each
import { Children } from "react";
export const Each = (props: { children: unknown }) => {
  Children.forEach(props.children, () => undefined);
  return null;
};
