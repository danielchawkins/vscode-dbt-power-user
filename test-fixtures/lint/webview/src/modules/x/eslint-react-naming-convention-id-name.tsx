// lint-expect: eslint @eslint-react/naming-convention-id-name
import { useId } from "react";
export const useLabel = () => {
  const label = useId();
  return label;
};
