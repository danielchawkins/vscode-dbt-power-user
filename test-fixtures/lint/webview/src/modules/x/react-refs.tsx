// lint-expect: oxlint react/refs
import { useRef } from "react";
export function Reader() {
  const box = useRef<number>(0);
  return <div>{box.current}</div>;
}
