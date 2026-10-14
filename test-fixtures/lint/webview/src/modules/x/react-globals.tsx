// lint-expect: oxlint react/globals
let renders = 0;
export function Counter() {
  renders += 1;
  return <div>{renders}</div>;
}
