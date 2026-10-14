// lint-expect: oxlint react/preserve-manual-memoization
import { useMemo } from "react";
export function Pair(props: { a: { x: number } }) {
  const v = useMemo(() => props.a.x, []);
  return <div>{v}</div>;
}
