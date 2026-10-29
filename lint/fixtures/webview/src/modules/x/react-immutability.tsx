// lint-expect: oxlint react/immutability
import { useMemo } from "react";
export function Mutator(props: { a: { x: number } }): JSX.Element {
  const v = useMemo(() => ({ n: props.a.x }), [props.a.x]);
  v.n = 2;
  return <div>{v.n}</div>;
}
