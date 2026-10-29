// lint-expect: eslint @eslint-react/no-nested-lazy-component-declarations
import { lazy } from "react";
export const Outer = () => {
  const Lazy = lazy(() => import("./x"));
  return <Lazy />;
};
