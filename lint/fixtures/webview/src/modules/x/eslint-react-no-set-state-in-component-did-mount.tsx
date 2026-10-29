// lint-expect: eslint @eslint-react/no-set-state-in-component-did-mount
import { Component } from "react";
export class M extends Component {
  state = { n: 0 };
  componentDidMount() {
    this.setState({ n: 1 });
  }
  render() {
    return null;
  }
}
