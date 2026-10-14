// lint-expect: eslint @eslint-react/no-children-to-array
import { Children } from "react";
export const Arr = (props: { children: unknown }) => {
  Children.toArray(props.children);
  return null;
};
