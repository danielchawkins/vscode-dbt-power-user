// lint-expect: eslint @eslint-react/use-state
import { useState } from "react";
export const useCount = () => {
  const [count, setter] = useState(0);
  return [count, setter] as const;
};
