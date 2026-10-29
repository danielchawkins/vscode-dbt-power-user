// lint-expect: eslint @eslint-react/no-create-ref
import { createRef } from "react";
export const Box = () => {
  const ref = createRef();
  return <div ref={ref} />;
};
