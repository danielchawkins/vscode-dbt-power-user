// lint-expect: oxlint typescript/no-this-alias
export class C {
  m(): C {
    const self = this;
    return self;
  }
}
