// lint-expect: oxlint react/exhaustive-deps
import { useEffect } from "react";
export function C(p: { a: number }) {
  useEffect(() => {
    void p.a;
  }, []);
  return null;
}
