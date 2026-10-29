// lint-expect: oxlint react/set-state-in-render
import { useState } from "react";
export function C() {
  const [a, setA] = useState(0);
  setA(1);
  return <div>{a}</div>;
}
