// lint-expect: oxlint typescript/no-unsafe-enum-comparison
export enum E {
  A,
}
export const b = (x: number) => x === E.A;
