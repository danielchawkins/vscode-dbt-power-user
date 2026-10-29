// lint-expect: eslint @eslint-react/no-set-state-in-component-did-update
import { Component } from "react";
export class M extends Component {
  state = { n: 0 };
  componentDidUpdate() {
    this.setState({ n: 1 });
  }
  render() {
    return null;
  }
}
