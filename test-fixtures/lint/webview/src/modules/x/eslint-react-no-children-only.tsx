// lint-expect: eslint @eslint-react/no-children-only
import { Children } from "react";
export const Only = (props: { children: unknown }) => {
  Children.only(props.children);
  return null;
};
