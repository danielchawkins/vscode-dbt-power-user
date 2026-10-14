// lint-expect: oxlint typescript/no-misused-new
export interface C {
  new (): C;
}
