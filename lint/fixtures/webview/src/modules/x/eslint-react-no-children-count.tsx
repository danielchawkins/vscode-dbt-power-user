// lint-expect: eslint @eslint-react/no-children-count
import { Children } from "react";
export const Count = (props: { children: unknown }) => {
  Children.count(props.children);
  return null;
};
