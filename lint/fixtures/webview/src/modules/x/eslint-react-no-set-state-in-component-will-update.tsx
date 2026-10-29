// lint-expect: eslint @eslint-react/no-set-state-in-component-will-update
import { Component } from "react";
export class M extends Component {
  state = { n: 0 };
  componentWillUpdate() {
    this.setState({ n: 1 });
  }
  render() {
    return null;
  }
}
