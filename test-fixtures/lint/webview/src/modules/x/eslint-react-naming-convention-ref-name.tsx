// lint-expect: eslint @eslint-react/naming-convention-ref-name
import { useRef } from "react";
export const useBox = () => {
  const box = useRef(null);
  return box;
};
