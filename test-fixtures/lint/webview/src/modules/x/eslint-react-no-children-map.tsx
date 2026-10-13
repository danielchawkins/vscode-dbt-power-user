// lint-expect: eslint @eslint-react/no-children-map
import { Children } from "react";
export const Map = (props: { children: unknown }) => {
  Children.map(props.children, (c) => c);
  return null;
};
