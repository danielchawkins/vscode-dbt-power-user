// lint-expect: oxlint react/no-array-index-key
export const l = (a: string[]) => a.map((x, i) => <li key={i}>{x}</li>);
