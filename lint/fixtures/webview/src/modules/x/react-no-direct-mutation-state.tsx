// lint-expect: oxlint react/no-direct-mutation-state
import { Component } from "react";
export class C extends Component<object, { a: number }> {
  state = { a: 1 };
  m(): void {
    this.state.a = 2;
  }
  render() {
    return null;
  }
}
