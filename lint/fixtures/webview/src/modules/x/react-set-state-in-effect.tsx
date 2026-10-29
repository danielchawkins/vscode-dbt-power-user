// lint-expect: oxlint react/set-state-in-effect
import { useEffect, useState } from "react";
export function C() {
  const [a, setA] = useState(0);
  useEffect(() => {
    setA(1);
  });
  return <div>{a}</div>;
}
