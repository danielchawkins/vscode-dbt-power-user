// lint-expect: oxlint react/use-memo
import { useMemo } from "react";
export const C = () => {
  const m = useMemo(() => {}, []);
  return m;
};
