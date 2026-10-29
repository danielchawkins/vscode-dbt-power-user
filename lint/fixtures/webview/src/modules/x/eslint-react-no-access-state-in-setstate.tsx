// lint-expect: eslint @eslint-react/no-access-state-in-setstate
import { Component } from "react";
export class Counter extends Component<object, { n: number }> {
  state = { n: 0 };
  bump() {
    this.setState({ n: this.state.n + 1 });
  }
  render() {
    return null;
  }
}
